// Pure functions for computing/reversing the settings.json patch the installer applies
// (PLAN.md §2.1). Kept separate from install.mjs/uninstall.mjs's filesystem/CLI code
// so the merge and unmerge logic itself is unit-testable without touching real paths.

// UserPromptSubmit added 2026-09-23 (audit F4): without it a session that is thinking or
// writing a text-only reply, with no tool call, still reads "idle" from its last Stop.
// StopFailure, PermissionRequest, PostToolUseFailure added 2026-09-25 (brief 04 P2): an API
// error ends the turn with StopFailure, not Stop, so without it a failed turn read "processing".
export const HOOK_EVENTS = [
  "Stop", "PreToolUse", "PostToolUse", "Notification", "SessionStart", "SessionEnd", "UserPromptSubmit",
  "StopFailure", "PermissionRequest", "PostToolUseFailure",
];

export function hookWriterCommand(shimDir) {
  return `bash ${shimDir}/hook-writer.sh`;
}

export function statuslineWrapperCommand(shimDir, originalCommand) {
  const wrapper = `bash ${shimDir}/statusline-wrapper.sh`;
  if (!originalCommand) return wrapper;
  return `ZOFIA_ORIGINAL_STATUSLINE_CMD=${shellQuote(originalCommand)} ${wrapper}`;
}

// Recognised by the exact shape statuslineWrapperCommand writes, not by the path. The
// first check looked for "zofia" in the path (then case-insensitively, 2026-09-23), so a
// re-install from a checkout with any other name wrapped Zofia's own wrapper a second
// time (research brief 03, 2026-09-25).
const WRAPPER_RE = /^(?:ZOFIA_ORIGINAL_STATUSLINE_CMD='(?:[^']|'\\'')*' )?bash .+\/statusline-wrapper\.sh$/;
export function isZofiaWrapper(command) {
  return WRAPPER_RE.test(command);
}

function shellQuote(str) {
  return `'${String(str).replaceAll("'", `'\\''`)}'`;
}

/**
 * Returns { nextSettings, changes } — changes is a plain-language list describing
 * exactly what would be added/changed, for the diff-confirmed install PLAN.md §2.1
 * requires. Never mutates `settings`.
 * @param {object} settings parsed ~/.claude/settings.json (or {} if absent)
 * @param {{ shimDir: string }} opts
 */
export function computeInstallPatch(settings, { shimDir }) {
  const next = structuredClone(settings ?? {});
  const changes = [];

  const originalStatusLine = settings?.statusLine ?? null;
  const alreadyOurs =
    originalStatusLine?.type === "command" && typeof originalStatusLine.command === "string" && isZofiaWrapper(originalStatusLine.command);

  let originalCommand = null;
  if (originalStatusLine && !alreadyOurs) {
    if (originalStatusLine.type !== "command" || typeof originalStatusLine.command !== "string") {
      throw new Error(
        `existing statusLine is type "${originalStatusLine.type}", not "command" — install.mjs only knows how to wrap a command-type statusLine; refusing to guess`
      );
    }
    originalCommand = originalStatusLine.command;
  }

  if (!alreadyOurs) {
    next.statusLine = { type: "command", command: statuslineWrapperCommand(shimDir, originalCommand) };
    changes.push(
      originalCommand
        ? `statusLine: wrap existing command ("${originalCommand}") so it still runs and its output still shows, unchanged`
        : `statusLine: install Zofia's capture-only wrapper (no statusLine existed before; Zofia prints no status text, but with any statusLine configured Claude Code hides most footer key hints, e.g. "esc to interrupt")`
    );
  } else {
    changes.push("statusLine: already Zofia's wrapper — left as-is");
  }

  const ourHookCommand = hookWriterCommand(shimDir);
  next.hooks = structuredClone(settings?.hooks ?? {});
  const injectedHooks = [];
  for (const event of HOOK_EVENTS) {
    const arr = next.hooks[event] ?? [];
    const alreadyPresent = arr.some((entry) => (entry.hooks ?? []).some((h) => h.command === ourHookCommand));
    if (alreadyPresent) {
      changes.push(`hooks.${event}: Zofia's handler already registered — left as-is`);
      continue;
    }
    next.hooks[event] = [...arr, { hooks: [{ type: "command", command: ourHookCommand }] }];
    injectedHooks.push({ event, command: ourHookCommand });
    changes.push(`hooks.${event}: add Zofia's capture handler alongside the ${arr.length} existing entr${arr.length === 1 ? "y" : "ies"}`);
  }

  return {
    nextSettings: next,
    changes,
    record: {
      original_statusline: originalStatusLine && !alreadyOurs ? originalStatusLine : alreadyOurs ? "already-ours-skip" : null,
      injected_hooks: injectedHooks,
    },
  };
}

/**
 * Folds a new install's record into the one a previous install left behind (audit F8,
 * 2026-09-23). A re-install sees Zofia's own wrapper and hooks, so on its own it would
 * record "already-ours-skip" and only the newly added hooks, and overwriting the old
 * record with that loses the owner's original statusLine and makes uninstall a no-op.
 * Keeps the first install's original statusLine and pre-install backup, and the union
 * of every injected hook.
 */
export function mergeInstallRecords(prior, record) {
  if (!prior) return record;
  const keepOriginal = record.original_statusline === "already-ours-skip" && prior.original_statusline !== undefined;
  const hooks = [...(prior.injected_hooks ?? [])];
  for (const h of record.injected_hooks ?? []) {
    if (!hooks.some((p) => p.event === h.event && p.command === h.command)) hooks.push(h);
  }
  return {
    ...record,
    original_statusline: keepOriginal ? prior.original_statusline : record.original_statusline,
    injected_hooks: hooks,
    ...(prior.backup_path ? { backup_path: prior.backup_path } : {}),
  };
}

/**
 * Reverses a prior install using the saved install record. Throws if the record's
 * original_statusline can't be found where install.mjs would have put it (caller is
 * expected to have already verified the whole-file hash first — PLAN.md §2.1's
 * "uninstall restores only if that hash still matches" rule lives in uninstall.mjs,
 * not here, so this function stays a pure, testable transform).
 */
export function computeUninstallPatch(settings, record) {
  const next = structuredClone(settings ?? {});
  const changes = [];

  if (record.original_statusline === "already-ours-skip") {
    // install.mjs found Zofia's wrapper already there and didn't touch statusLine —
    // uninstall shouldn't touch it either.
  } else if (record.original_statusline) {
    next.statusLine = record.original_statusline;
    changes.push("statusLine: restored to the owner's original command");
  } else {
    delete next.statusLine;
    changes.push("statusLine: removed (none existed before Zofia's install)");
  }

  next.hooks = structuredClone(settings?.hooks ?? {});
  for (const { event, command } of record.injected_hooks ?? []) {
    const arr = next.hooks[event] ?? [];
    const filtered = arr.filter((entry) => !(entry.hooks ?? []).every((h) => h.command === command) || (entry.hooks ?? []).length !== 1);
    next.hooks[event] = filtered;
    changes.push(`hooks.${event}: removed Zofia's capture handler`);
    if (next.hooks[event].length === 0) delete next.hooks[event];
  }
  if (Object.keys(next.hooks).length === 0) delete next.hooks;

  return { nextSettings: next, changes };
}
