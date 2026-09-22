// Pure functions for computing/reversing the settings.json patch the installer applies
// (PLAN.md §2.1). Kept separate from install.mjs/uninstall.mjs's filesystem/CLI code
// so the merge and unmerge logic itself is unit-testable without touching real paths.

export const HOOK_EVENTS = ["Stop", "PreToolUse", "PostToolUse", "Notification", "SessionStart", "SessionEnd"];

export function hookWriterCommand(shimDir) {
  return `bash ${shimDir}/hook-writer.sh`;
}

export function statuslineWrapperCommand(shimDir, originalCommand) {
  const wrapper = `bash ${shimDir}/statusline-wrapper.sh`;
  if (!originalCommand) return wrapper;
  return `ZOFIA_ORIGINAL_STATUSLINE_CMD=${shellQuote(originalCommand)} ${wrapper}`;
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
    originalStatusLine?.type === "command" && typeof originalStatusLine.command === "string" && originalStatusLine.command.includes("zofia") && originalStatusLine.command.includes("statusline-wrapper.sh");

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
        : `statusLine: install Zofia's capture-only wrapper (no statusLine existed before; Zofia prints nothing extra, so Claude Code's default footer is unaffected)`
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
