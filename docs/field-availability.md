# Session-state field availability — measured

HANDOFF.md item 1 / PLAN.md §2.2. Converts every `unknown`/`approximable` placeholder
cell in the council plan's pre-probe matrix into a real answer, each with its source.

**What "measured" means here, honestly.** Two of the three legs the council plan
expected (statusline JSON, hooks JSON) are answered from a primary source: Claude
Code's own published reference docs (`code.claude.com/docs/en/statusline`,
`code.claude.com/docs/en/hooks`, fetched 2026-09-22), cross-checked against the
owner's own real, already-installed, already-working `~/.claude/statusline-command.sh`
on his actual CLI version (2.1.280) — that script extracts `.model.display_name`,
`.effort.level`, `.rate_limits.five_hour.{used_percentage,resets_at}` and
`.context_window.used_percentage` in his daily use today, so those four are confirmed
twice over, not just documented. **2026-09-22, updated**: the live 10-minute capture
also happened for real — the shim installed into the owner's actual
`~/.claude/settings.json` (his go, `PLAN.md` §10 decision #2; see `DECISIONS.md`) and
ran against 5 real sessions on his machine for the full window. Rows below are updated
with what that capture actually showed, including one real surprise (rows 3-4) that
wasn't visible from the owner's script alone. Nothing below is asserted as live-measured
that wasn't.

The reader CLI (`reader/`) implements every row below exactly as stated; see
`reader/src/deriveSnapshot.mjs` for the code and `reader/test/deriveSnapshot.test.mjs`
for a test per row.

| # | Field | Availability | Source | Live-session capture |
|---|---|---|---|---|
| 1 | **Model** | exposed | statusline JSON `model.display_name` / `model.id`. Always present. | Confirmed live — owner's own script reads this today. |
| 2 | **Effort** | exposed | statusline JSON `effort.level`. Documented as absent "only when the current model supports the reasoning effort parameter" — otherwise present. | Confirmed live — owner's own script reads this today. |
| 3 | **Usage %** (5-hour) | exposed | statusline JSON `rate_limits.five_hour.used_percentage`. Documented as absent until Pro/Max (or a spend-limited gateway) *and* only after the session's first API response. **Real live-capture finding, 2026-09-22**: `rate_limits` and `rate_limits.five_hour` are two independently-absent things, not one — 3 of 5 real sessions captured had `rate_limits.seven_day` present with `five_hour` missing, all three idle at capture time; the two sessions with recent activity had `five_hour`. Exact trigger for `five_hour` reappearing isn't isolated yet (a fresh API response in that session is the leading guess, not confirmed) — `deriveSnapshot.mjs` now reports a distinct, accurate reason for "present but five_hour missing" instead of wrongly claiming `rate_limits` itself is absent (see `DECISIONS.md`). | Confirmed live — owner's own script reads this today, and the 2026-09-22 capture across 5 real sessions. |
| 4 | **5-hour reset timer** | exposed | statusline JSON `rate_limits.five_hour.resets_at` (unix epoch seconds). Same two absence conditions as Usage % (row 3) — **not** the same single condition, corrected 2026-09-22. **Never derived locally from usage timestamps** (PLAN.md §8 trigger 1) — if `five_hour` is absent (whether or not `rate_limits` itself is present), this renders `unknown`, permanently for that source, exactly as the plan requires. | Confirmed live — owner's own script reads this today, and the 2026-09-22 capture across 5 real sessions. |
| 5 | **Context %** | exposed | statusline JSON `context_window.used_percentage`. **This corrects the plan's own pre-probe placeholder**, which expected we'd need a token-arithmetic proxy (LOW confidence) — Claude Code pre-computes this field itself; no proxy is built. Documented as possibly `null` early in a session or right after `/compact`. | Confirmed live — owner's own script reads this today. |
| 6 | **Activity state** | approximable | Derived from the shim's `latest_hook_event` (hook_event_name + notification_type), never from a timer alone. State machine in `deriveSnapshot.mjs`; see the "Real semantic-bug rule, still honored" section below. | Confirmed live, 2026-09-22 — a real session's captured state showed `latest_hook_event.hook_event_name: "PreToolUse"` / `tool_name: "Bash"` at the moment of a real tool call, correctly reflected rather than stale; the two actively-worked sessions of the 5 captured both carried live hook events, the three idle ones didn't advance past their install-time snapshot. |
| 7 | **"XYZ for 49s · done XX:YY" line** | **unknown, confirmed** | Not exposed by any documented interface for a corner session. Hook payloads for `PreToolUse`/`PostToolUse` carry no timing field (checked against the full hooks reference); statusline only has session-*cumulative* `cost.total_duration_ms` / `cost.total_api_duration_ms`, not a per-tool-call timer matching this literal spinner line. This resolves PLAN.md §2.2's "disputed" cell: the plan's own last column was already right — `exposed (center seat only)` — meaning for a corner session (this bridge's actual target) it's genuinely unavailable, not merely un-probed. | N/A — confirmed unavailable by design, not by absence of a test. |
| 8 | **Token spend (USD)** | exposed | statusline JSON `cost.total_cost_usd`. Resets to $0 on `/clear`. | Confirmed live, 2026-09-22 — a real session's captured state carried `cost.total_cost_usd: 18.13…`, a real non-zero figure the owner's own script never reads today but the shim captures directly. |
| 9 | **Token spend (token counts)** | approximable | statusline JSON `context_window.total_input_tokens` / `total_output_tokens`. **Important nuance the plan flagged and this confirms**: these are the *current context window's* token counts, from the most recent API response — not a cumulative lifetime-spend counter. Kept strictly distinct from `tokenSpend.usd` in the CLI's own output shape (PLAN.md §2.2: "never conflated"). Available from the default statusline source — **no opt-in transcript toggle is needed for this field**, correcting the plan's expectation that it might require one. | Confirmed live, 2026-09-22 — the same real session carried `context_window.total_input_tokens: 99993` / `total_output_tokens: 8`, genuinely distinct from the USD figure in row 8, exactly as the CLI's output shape requires. |
| 10 | **Last-active time** | exposed | Derived: `max(latest_statusline.observed_at, latest_hook_event.observed_at)` — the shim's own capture timestamps, never file `mtime` (PLAN.md §2.2's own caught bug). | Confirmed by construction (`reader/test/deriveSnapshot.test.mjs`); a live session would only confirm timestamps arrive in the right order, which the unit tests already exercise directly. |

Table has 10 rows because "token spend" is genuinely two numbers the plan insists stay
distinct (#8, #9); the CLI's own JSON groups them under one `tokenSpend` key with two
sub-fields, matching HANDOFF.md's "nine field keys" literally — see
`reader/src/fieldSchema.mjs`.

## CLI launch flags (center seat)

<a id="cli-effort-flag"></a>**Effort flag.** `claude --help` for 2.1.280 lists `--effort <level>`: "Effort
level for the current session (low, medium, high, xhigh, max)". Checked by C&C (thcmcp-31)
on 2026-09-23. This session confirmed it without running the CLI, by finding the same
help strings in the installed 2.1.280 binary. `config/providers.json` uses it as
`effort_key`, and the seat launches with `--effort medium` (owner decision 2).
**Not measured:** which levels each model accepts, and what any level costs in tokens,
time or quality. `effort_levels` stays `UNKNOWN` for every model.

## A finding beyond the table: the opt-in transcript toggle isn't needed for v1

PLAN.md §2.1 built in an opt-in, off-by-default transcript-JSONL fallback specifically
because week 1 might find a field that needs it. It doesn't: contextPercent is directly
exposed (row 5), tokenSpend's token-count leg is directly exposed as an approximation
(row 9), and the duration line is confirmed unavailable regardless of source (row 7).
**The reader CLI does not implement the transcript-reading code path at all** — not
"implemented but disabled," genuinely absent — which is also the mechanism behind the
"default run opens no transcript file" acceptance test: there's no code path that could.
If a future field ever needs it, PLAN.md §9.2 item 6 still requires it ship opt-in, off
by default.

## Real semantic-bug rule, still honored

PLAN.md §2.1's own caught bug: don't label a session "idle" just because nothing's been
heard from it for N seconds — silence isn't a status. `deriveSnapshot.mjs` only ever
reports `idle` after a *verified* lifecycle event (`Stop`, or a `Notification` with
`notification_type: agent_completed`). A non-terminal state (mid-tool-call, mid-prompt)
that's gone quiet for over 120s renders `stale (last event Ns ago)` instead — distinct
from both "still running" and "idle." Terminal-death is its own case, verified via
`kill -0` against the shim-captured owning PID, not inferred from any timeout.

## Still open (real, not rhetorical)

- Whether the 120-second staleness threshold feels right in practice; it's a named,
  reasoned placeholder (same number the plan's own caught bug used, reused deliberately
  for a different purpose), not yet tuned against a real session's actual event cadence.
- What exactly brings `rate_limits.five_hour` back once it's missing (rows 3-4) — the
  2026-09-22 live capture found the absence but didn't isolate the trigger. A fresh API
  response in that session is the leading guess, not a confirmed condition.
