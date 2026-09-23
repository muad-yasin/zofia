# TODO — Archive

Completed or explicitly retired items move here from `TODO.md`, in the same session
they close — `~/Projects/SMO/TODO.md`'s own convention, adopted here for consistency
across the owner's projects. One dated entry per item; never rewritten once archived.

## 2026-09-23

- **Pick the actual C&C model** (`PLAN.md` §10 decision 4, `TODO.md`'s "waiting on the
  owner" item 4) — resolved. Owner's own words, relayed by thcmcp-aa from the C&C chat:
  "C&C model is Sonnet, latest build." Read as Claude Code's own `sonnet` alias
  (always-latest), not a pinned dated model id. Full provenance in `DECISIONS.md`;
  `ROADMAP.md`'s owner-decisions list updated to match. The concrete config value is
  item 4's own build work, not done here.

## Closed 2026-09-23 (zofia-26)

- **Session assignment didn't persist across a GUI restart.** The owner picked option B
  (`DECISIONS.md`); built in `a9b6a29`. Verified in the real packaged window by
  `test/appimage/live-gaps.mjs` (`e08caa7`): restored and marked after a relaunch, then
  emptied by Clear all.
- **`invoke("register_session", …)` had never fired at runtime.** It has now, in the
  real packaged window: `live-gaps.mjs` shows a file written before the assignment
  arriving through register_session's own emit, so `sessionId` reaches Rust's
  `session_id` (`e08caa7`).

## Closed 2026-09-23 (Zofia builder, for C&C thcmcp-31)

- **Owner decision 2, effort default.** Muad, relayed by C&C (thcmcp-31): *"I'd go with
  Medium as the default"*. `config/providers.json` `default_effort: medium`, with detail in
  `DECISIONS.md`. The per-model levels and the CLI effort key stay `UNKNOWN` until
  measured, so no launch applies it yet.
- **Owner decision 1, his own ToS read.** Muad, relayed by C&C (thcmcp-31): *"always a
  human giving the C&C session instructions ... this is 'ordinary, individual usage' ...
  I think this concept is OK to proceed"*. Details in `DECISIONS.md`. Item 8 still waits
  on the clearance file only he creates (TODO "Waiting on the owner" 1).
