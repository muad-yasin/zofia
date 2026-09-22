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
twice over, not just documented. What is **not yet done**: a live 10-minute capture
against a real session with the shim actually installed. That step needs the shim
registered in a real `~/.claude/settings.json`, which is gated on `PLAN.md` §10
decision #2 (the owner confirming the install mechanism doesn't conflict with what
he's already got configured) — see `DECISIONS.md` for why this wasn't done
unilaterally. Everything below is marked accordingly; nothing is asserted as
live-measured that wasn't.

The reader CLI (`reader/`) implements every row below exactly as stated; see
`reader/src/deriveSnapshot.mjs` for the code and `reader/test/deriveSnapshot.test.mjs`
for a test per row.

| # | Field | Availability | Source | Live-session capture |
|---|---|---|---|---|
| 1 | **Model** | exposed | statusline JSON `model.display_name` / `model.id`. Always present. | Confirmed live — owner's own script reads this today. |
| 2 | **Effort** | exposed | statusline JSON `effort.level`. Documented as absent "only when the current model supports the reasoning effort parameter" — otherwise present. | Confirmed live — owner's own script reads this today. |
| 3 | **Usage %** (5-hour) | exposed | statusline JSON `rate_limits.five_hour.used_percentage`. Documented as absent until Pro/Max (or a spend-limited gateway) *and* only after the session's first API response. | Confirmed live — owner's own script reads this today. |
| 4 | **5-hour reset timer** | exposed | statusline JSON `rate_limits.five_hour.resets_at` (unix epoch seconds). Same absence conditions as Usage %. **Never derived locally from usage timestamps** (PLAN.md §8 trigger 1) — if `rate_limits` is absent, this renders `unknown`, permanently for that source, exactly as the plan requires. | Confirmed live — owner's own script reads this today. |
| 5 | **Context %** | exposed | statusline JSON `context_window.used_percentage`. **This corrects the plan's own pre-probe placeholder**, which expected we'd need a token-arithmetic proxy (LOW confidence) — Claude Code pre-computes this field itself; no proxy is built. Documented as possibly `null` early in a session or right after `/compact`. | Confirmed live — owner's own script reads this today. |
| 6 | **Activity state** | approximable | Derived from the shim's `latest_hook_event` (hook_event_name + notification_type), never from a timer alone. State machine in `deriveSnapshot.mjs`; see the "Real semantic-bug rule, still honored" section below. | Not yet — needs a live session generating real hook traffic (tool calls, a Stop, etc.) to confirm the label set feels right in practice. |
| 7 | **"XYZ for 49s · done XX:YY" line** | **unknown, confirmed** | Not exposed by any documented interface for a corner session. Hook payloads for `PreToolUse`/`PostToolUse` carry no timing field (checked against the full hooks reference); statusline only has session-*cumulative* `cost.total_duration_ms` / `cost.total_api_duration_ms`, not a per-tool-call timer matching this literal spinner line. This resolves PLAN.md §2.2's "disputed" cell: the plan's own last column was already right — `exposed (center seat only)` — meaning for a corner session (this bridge's actual target) it's genuinely unavailable, not merely un-probed. | N/A — confirmed unavailable by design, not by absence of a test. |
| 8 | **Token spend (USD)** | exposed | statusline JSON `cost.total_cost_usd`. Resets to $0 on `/clear`. | Not yet — the owner's own script doesn't read this field today, so it's doc-only until a live capture. |
| 9 | **Token spend (token counts)** | approximable | statusline JSON `context_window.total_input_tokens` / `total_output_tokens`. **Important nuance the plan flagged and this confirms**: these are the *current context window's* token counts, from the most recent API response — not a cumulative lifetime-spend counter. Kept strictly distinct from `tokenSpend.usd` in the CLI's own output shape (PLAN.md §2.2: "never conflated"). Available from the default statusline source — **no opt-in transcript toggle is needed for this field**, correcting the plan's expectation that it might require one. | Not yet — doc-only until a live capture. |
| 10 | **Last-active time** | exposed | Derived: `max(latest_statusline.observed_at, latest_hook_event.observed_at)` — the shim's own capture timestamps, never file `mtime` (PLAN.md §2.2's own caught bug). | Confirmed by construction (`reader/test/deriveSnapshot.test.mjs`); a live session would only confirm timestamps arrive in the right order, which the unit tests already exercise directly. |

Table has 10 rows because "token spend" is genuinely two numbers the plan insists stay
distinct (#8, #9); the CLI's own JSON groups them under one `tokenSpend` key with two
sub-fields, matching HANDOFF.md's "nine field keys" literally — see
`reader/src/fieldSchema.mjs`.

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

- The live 10-minute capture itself — see the top of this file and `DECISIONS.md`.
- Whether the 120-second staleness threshold feels right in practice; it's a named,
  reasoned placeholder (same number the plan's own caught bug used, reused deliberately
  for a different purpose), not yet tuned against a real session's actual event cadence.
