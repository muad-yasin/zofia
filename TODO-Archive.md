# TODO — Archive

Completed or explicitly retired items move here from `TODO.md`, in the same session
they close — a convention the owner uses across his projects. One dated entry per item; never rewritten once archived.

## 2026-09-23

- **Pick the actual C&C model** (`PLAN.md` §10 decision 4, `TODO.md`'s "waiting on the
  owner" item 4) — resolved. Owner decision, 2026-09-23: the C&C model is
  Sonnet, latest build. Read as Claude Code's own `sonnet` alias
  (always-latest), not a pinned dated model id. Full provenance in `DECISIONS.md`;
  `ROADMAP.md`'s owner-decisions list updated to match. The concrete config value is
  item 4's own build work, not done here.

## Closed 2026-09-23 (builder B)

- **Session assignment didn't persist across a GUI restart.** The owner picked option B
  (`DECISIONS.md`); built in `a9b6a29`. Verified in the real packaged window by
  `test/appimage/live-gaps.mjs` (`e08caa7`): restored and marked after a relaunch, then
  emptied by Clear all.
- **`invoke("register_session", …)` had never fired at runtime.** It has now, in the
  real packaged window: `live-gaps.mjs` shows a file written before the assignment
  arriving through register_session's own emit, so `sessionId` reaches Rust's
  `session_id` (`e08caa7`).

## Closed 2026-09-23 (Zofia builder, for C&C)

- **Owner decision 2, effort default.** Owner decision, 2026-09-23: Medium.
  `config/providers.json` `default_effort: medium`, with detail in
  `DECISIONS.md`. Later the same day, C&C found the CLI's `--effort` flag and the seat
  now launches with `--effort medium`. Per-model levels stay `UNKNOWN`.
- **Owner decision 1, his own ToS read.** Owner decision, 2026-09-23: the center-seat
  concept is OK to proceed, on the premise that a human always instructs the C&C seat. Details in `DECISIONS.md`. Item 8 still waits
  on the clearance file only he creates (TODO "Waiting on the owner" 1).
