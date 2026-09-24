// Turns the shim's raw captured state (what statusline-wrapper.sh / hook-writer.sh
// actually observed — see shim/README.md for the exact raw schema) into the nine-field
// SessionSnapshot HANDOFF.md item 1 requires, each leaf carrying real provenance.
//
// Source grounding for every "exposed" claim below (PLAN.md's own "measure, don't
// guess" discipline, §2.2, §12): Claude Code's published statusline reference
// (code.claude.com/docs/en/statusline, fetched 2026-09-22) and hooks reference
// (code.claude.com/docs/en/hooks, fetched 2026-09-22), cross-checked against the
// owner's own already-installed, already-working ~/.claude/statusline-command.sh
// (CLI 2.1.280), which extracts .model.display_name, .effort.level,
// .rate_limits.five_hour.{used_percentage,resets_at} and .context_window.used_percentage
// in production today. docs/field-availability.md records the full reasoning per field,
// including the one still-pending item: a live capture against a real session, gated on
// PLAN.md §10 decision #2 (owner confirms the install doesn't conflict with what he's
// already got configured) — see DECISIONS.md.

import { field, unknownField, AVAILABILITY } from "./fieldSchema.mjs";

const STALE_AFTER_S = 120; // PLAN.md §2.1's own caught bug used this number to wrongly
// assert "idle" after a silence. Reused here only to label a *non-terminal* state
// "stale" when nothing newer has arrived AND no owning process is recorded to check —
// never to assert idle, and never on a process known to be alive (Q2).

const TERMINAL_HOOK_EVENTS = new Set(["Stop", "SessionEnd"]);

/**
 * @param {object|null} raw parsed contents of the per-session state file, or null if
 *   the shim has never observed this session (file absent).
 * @param {{ now?: number, isProcessAlive?: (pid: number) => boolean }} [opts]
 */
export function deriveSnapshot(raw, opts = {}) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const isProcessAlive = opts.isProcessAlive ?? defaultIsProcessAlive;

  if (!raw) {
    const reason = "no state file for this session_id — nothing observed yet, or the shim isn't installed";
    return Object.fromEntries(
      ["model", "effort", "usagePercent", "resetTimer", "contextPercent", "activityState", "durationLine", "lastActiveTime"]
        .map((k) => [k, unknownField(reason)])
        .concat([["tokenSpend", { usd: unknownField(reason), tokens: unknownField(reason) }]])
    );
  }

  const sl = raw.latest_statusline ?? null;
  const hook = raw.latest_hook_event ?? null;

  return {
    model: deriveModel(sl),
    effort: deriveEffort(sl),
    usagePercent: deriveRateLimitPct(sl),
    resetTimer: deriveRateLimitReset(sl),
    contextPercent: deriveContextPercent(sl),
    activityState: deriveActivityState(hook, raw.pid ?? null, now, isProcessAlive),
    durationLine: deriveDurationLine(raw, hook, now, isProcessAlive),
    tokenSpend: {
      usd: deriveTokenSpendUsd(sl),
      tokens: deriveTokenSpendTokens(sl),
    },
    lastActiveTime: deriveLastActiveTime(sl, hook),
  };
}

function deriveModel(sl) {
  if (sl?.model?.display_name) {
    return field(
      { id: sl.model.id ?? null, display_name: sl.model.display_name },
      AVAILABILITY.EXPOSED,
      "statusline JSON model.display_name / model.id",
      sl.observed_at
    );
  }
  return unknownField("statusline JSON model field not yet observed for this session");
}

function deriveEffort(sl) {
  if (sl?.effort?.level) {
    return field(sl.effort.level, AVAILABILITY.EXPOSED, "statusline JSON effort.level", sl.observed_at);
  }
  return unknownField(
    "statusline JSON effort field absent — either not yet observed, or the current model doesn't support the reasoning-effort parameter (Claude Code docs)"
  );
}

// Two genuinely different absence cases, confirmed distinct by the 2026-09-22 live
// capture (docs/field-availability.md rows 3-4): `rate_limits` itself can be missing
// entirely, or present with only `seven_day` while `five_hour` is missing — 3 of 5 real
// sessions captured that day had the latter (all idle at capture time; the two with
// recent activity had `five_hour`). What exactly brings `five_hour` back isn't isolated
// yet — a fresh API response in this session is the leading guess, not a confirmed
// trigger — so the reason string says only what's actually known.
function describeRateLimitAbsence(sl, whichField) {
  if (sl?.rate_limits && typeof sl.rate_limits === "object") {
    return `statusline JSON rate_limits is present but its five_hour block is absent right now (seven_day alone was present in a 2026-09-22 live capture, on idle sessions specifically) — exact trigger for five_hour appearing isn't isolated yet; never inferred locally, see ${whichField}`;
  }
  return "statusline JSON rate_limits absent entirely — appears only for Pro/Max subscribers (or a spend-limited gateway) and only after the session's first API response (Claude Code docs); never inferred locally";
}

function deriveRateLimitPct(sl) {
  const pct = sl?.rate_limits?.five_hour?.used_percentage;
  if (typeof pct === "number") {
    return field(pct, AVAILABILITY.EXPOSED, "statusline JSON rate_limits.five_hour.used_percentage", sl.observed_at);
  }
  return unknownField(describeRateLimitAbsence(sl, "rate_limits.five_hour.used_percentage"));
}

function deriveRateLimitReset(sl) {
  const resetsAt = sl?.rate_limits?.five_hour?.resets_at;
  if (typeof resetsAt === "number") {
    return field(resetsAt, AVAILABILITY.EXPOSED, "statusline JSON rate_limits.five_hour.resets_at (unix epoch seconds)", sl.observed_at);
  }
  return unknownField(describeRateLimitAbsence(sl, "rate_limits.five_hour.resets_at — per PLAN.md §8 trigger 1"));
}

function deriveContextPercent(sl) {
  const pct = sl?.context_window?.used_percentage;
  if (typeof pct === "number") {
    return field(pct, AVAILABILITY.EXPOSED, "statusline JSON context_window.used_percentage (Claude Code pre-computes this; no token-arithmetic proxy needed)", sl.observed_at);
  }
  return unknownField(
    "statusline JSON context_window.used_percentage is null/absent early in a session or right after /compact, until the next API call (Claude Code docs)"
  );
}

function deriveDurationLine(raw, hook, now, isProcessAlive) {
  // Claude Code's own spinner line ("Worked for 49s · done 14:20") is not exposed to a
  // corner session (docs/field-availability.md row 7). Quality check Q5 (2026-09-23): the
  // same fact is approximable from hook times the shim already sees. It records when the
  // latest prompt was submitted (turn_started_at); the turn ends at the next Stop.
  const start = raw.turn_started_at;
  if (typeof start !== "number" || !hook) {
    return unknownField("no prompt submitted since the shim began recording turn starts (2026-09-24)");
  }
  if (typeof raw.pid === "number" && !isProcessAlive(raw.pid)) {
    return unknownField(`owning process pid ${raw.pid} ended; the turn's end was never observed`);
  }
  const source = "approximated from the shim's hook times (UserPromptSubmit to Stop), not Claude Code's own spinner line";
  const done = hook.hook_event_name === "Stop" || (hook.hook_event_name === "Notification" && hook.notification_type === "agent_completed");
  if (done && hook.observed_at >= start) {
    return field(`worked for ${fmtElapsed(hook.observed_at - start)}`, AVAILABILITY.APPROXIMABLE, source, hook.observed_at);
  }
  if (hook.hook_event_name === "SessionEnd") return unknownField("the session ended before the turn's Stop");
  return field(`working for ${fmtElapsed(Math.max(0, now - start))}`, AVAILABILITY.APPROXIMABLE, source, start);
}

function deriveTokenSpendUsd(sl) {
  const usd = sl?.cost?.total_cost_usd;
  if (typeof usd === "number") {
    return field(usd, AVAILABILITY.EXPOSED, "statusline JSON cost.total_cost_usd", sl.observed_at);
  }
  return unknownField("statusline JSON cost field not yet observed for this session");
}

function deriveTokenSpendTokens(sl) {
  const inTok = sl?.context_window?.total_input_tokens;
  const outTok = sl?.context_window?.total_output_tokens;
  if (typeof inTok === "number" || typeof outTok === "number") {
    return field(
      { input_tokens: inTok ?? null, output_tokens: outTok ?? null },
      AVAILABILITY.APPROXIMABLE,
      "statusline JSON context_window.total_input_tokens/total_output_tokens — the CURRENT context window's token count, not a cumulative lifetime spend counter; kept strictly distinct from tokenSpend.usd (PLAN.md §2.2)",
      sl.observed_at
    );
  }
  return unknownField("statusline JSON context_window token counts not yet observed for this session");
}

function deriveLastActiveTime(sl, hook) {
  const candidates = [sl?.observed_at, hook?.observed_at].filter((t) => typeof t === "number");
  if (candidates.length === 0) {
    return unknownField("no statusline or hook event observed yet for this session");
  }
  const observedAt = Math.max(...candidates);
  return field(
    observedAt,
    AVAILABILITY.EXPOSED,
    "derived from the last observed statusline/hook event timestamp — never from file mtime (PLAN.md §2.2's own caught bug: mtime measures a write, not session activity)",
    observedAt
  );
}

function deriveActivityState(hook, pid, now, isProcessAlive) {
  if (!hook) {
    return unknownField("no lifecycle hook event observed yet for this session");
  }
  if (typeof pid === "number" && !isProcessAlive(pid)) {
    return field(
      "ended (process not running)",
      AVAILABILITY.EXPOSED,
      `owning process pid ${pid} is no longer alive — a verified fact, not a timeout inference (PLAN.md §2.1: terminal death is its own disconnection case)`,
      hook.observed_at
    );
  }

  const label = activityLabelForEvent(hook);
  const ageS = Math.max(0, now - hook.observed_at);
  const isTerminal = TERMINAL_HOOK_EVENTS.has(hook.hook_event_name) || label === "waiting for input" || label === "ready";
  if (isTerminal) {
    return field(label, AVAILABILITY.APPROXIMABLE, `derived from last hook event: ${hook.hook_event_name}`, hook.observed_at);
  }

  // Quality check Q2 (2026-09-23): a long tool call (a build, a test suite, a subagent) sends
  // no event until it finishes, so silence on a live process is the busiest state, not a stale
  // one. With the owning process verified alive, show the state and how long it has lasted
  // ("running tool: Bash · 4m 10s", the spec's "XYZ for 49s"). Only with no process to check
  // does a long silence become "stale" (PLAN.md §12: silence is not a status).
  const processAlive = typeof pid === "number";
  if (!processAlive && ageS > STALE_AFTER_S) {
    return field(
      `stale · last event ${fmtElapsed(ageS)} ago`,
      AVAILABILITY.APPROXIMABLE,
      `no hook event in the last ${STALE_AFTER_S}s since ${hook.hook_event_name} and no owning process recorded to check; not asserted idle or still-running`,
      hook.observed_at
    );
  }
  return field(
    `${label} · ${fmtElapsed(ageS)}`,
    AVAILABILITY.APPROXIMABLE,
    `derived from last hook event: ${hook.hook_event_name}; elapsed since it${processAlive ? `, owning process pid ${pid} alive` : ""}`,
    hook.observed_at
  );
}

/** 42 -> "42s", 250 -> "4m 10s", 7260 -> "2h 1m". */
export function fmtElapsed(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function activityLabelForEvent(hook) {
  switch (hook.hook_event_name) {
    case "SessionStart":
      return "ready"; // a new session waits for its first prompt
    case "UserPromptSubmit":
      return "processing";
    case "PreToolUse":
      return hook.tool_name ? `running tool: ${hook.tool_name}` : "running tool";
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PostToolBatch":
      return "processing";
    case "Stop":
      return "idle";
    case "SessionEnd":
      return `ended (${hook.end_reason ?? "unknown reason"})`;
    case "Notification":
      if (["agent_needs_input", "permission_prompt", "idle_prompt", "elicitation_dialog"].includes(hook.notification_type)) {
        return "waiting for input";
      }
      if (hook.notification_type === "agent_completed") {
        return "idle";
      }
      return `notification: ${hook.notification_type ?? "unknown"}`;
    default:
      return `stale (unrecognized event: ${hook.hook_event_name})`;
  }
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists but owned by someone else — still alive
  }
}
