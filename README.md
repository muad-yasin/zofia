# Zofia

A Linux AppImage GUI: one command-and-control overview of four Claude Code terminal
sessions the owner opens himself, plus a fifth, GUI-owned center seat he can chat with
directly. See `CLAUDE.md` for the owner's binding spec, and `PLAN.md`/`HANDOFF.md` for
the build plan and order. Private until the open-source release.

Status: building, per `HANDOFF.md`'s order. See `PROGRESS.md` for what's actually done.

**To run it:** [`docs/TRY-IT.md`](docs/TRY-IT.md) — where the AppImage is, how to start
it, and what you should see.

## Repo layout

- `CLAUDE.md` — the owner's binding spec and build rules.
- `PLAN.md` / `HANDOFF.md` — the council's build plan and literal build order.
  `BOARD.md` (gitignored, local only) is the debate record behind them.
- `ROADMAP.md` / `ROADMAP-Archive.md` — the live status-and-horizon view, one level up
  from `HANDOFF.md`'s item-by-item order.
- `PROGRESS.md` / `DECISIONS.md` / `BUILT.md` — what's actually done vs. assumed,
  judgment calls and real bugs found, and the commit log by Scope-ledger proposal id.
- `TODO.md` / `TODO-Archive.md` — the live punch list, same convention
  `~/Projects/SMO/TODO.md` uses.
- `docs/` — durable reference documentation (see `docs/README.md`).
- `Review/` — gitignored working review/audit notes, dated, never canonical.
- `reader/`, `src/`, `src-tauri/` — the reader CLI, the shell frontend, the Tauri
  backend. Each item's own tests live alongside it.
