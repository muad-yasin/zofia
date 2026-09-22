# HANDOFF.md — Zofia (premium plan)

Read `CLAUDE.md`, then this file, then `PLAN.md` in full before touching anything. `BOARD.md` is
the debate record — read it when you need to know why something was decided.

## Order of work

Build exactly one item at a time, in this order, per PLAN.md §8's two-week slice and its own build
order beyond that. Do not start item N+1 until item N's acceptance test passes and is committed.

1. **Week 1, Track A — the reader spike** (§8, §2.1, §2.2). Run the `zofia-reader` CLI against one
   real, manually-opened session for the full 10-minute window the spike specifies. Fill in
   `docs/field-availability.md`'s nine rows with real measured values, converting every §2.2
   pre-probe `unknown`/`approximable` cell into a measured fact. Acceptance: the CLI prints valid
   JSON with all nine field keys, each carrying a source tag; the default run opens no transcript
   file; a planted canary string is absent from every output.
2. **Week 1, Track B — the static shell** (§8, §4), after item 1 (one item at a time: CLAUDE.md's usage budget rules out parallel agents). The five-pane Tauri
   shell (top bar, four corners, center) on sample data, vanilla TypeScript, no framework migration.
   Acceptance: renders correctly at the three viewport sizes §4 names; zero `.svelte` imports.
3. **Week 2 — wire the reader into the shell** (§8, §2), gated on item 1's real matrix, not the
   pre-probe placeholders. Acceptance: §2's own fixture-replay test; corner panes show measured
   fields and an explicit `UNKNOWN` chip for anything the probe didn't confirm.
4. **Week 2 — center seat against a mock** (§8, §3). Build the owned-PTY center seat and exercise it
   against a mock `claude`, demonstrating real interactive parity (typed input, prompt rendering, an
   interruption key actually delivered) — not output streaming alone. Real-subscription testing
   waits on item 8 (the ToS gate). Acceptance: §3's ownership-boundary and tool-policy tests, run
   against the mock.
5. **Week 2 — first AppImage build** (§8, §6), independent of items 3-4, may build any time after
   item 2. Acceptance: §6's clean-VM smoke test, both the FUSE path and `--appimage-extract-and-run`.
6. **Week 2 — the zero-egress audit** (§8, §2.3), run against the full assembled shell, PID-tree
   scoped, not a host-wide capture. Acceptance: §2.3's own test, exactly as specified.
7. **Provider/effort config** (§5) — independent of the above, build any time; the concrete effort
   values themselves wait on item 1's real probe result. Acceptance: the config schema rejects an
   xAI/Grok model id at build time, and the runtime rejects one arriving by alias or typed id; every
   effort value carries a source tag pointing at item 1's measured matrix, or reads `UNKNOWN`.
8. **Real-subscription center-seat testing** — only after the owner has completed §10 decision 1
   (reading Anthropic's ToS himself). Do not test against his real subscription before that.
9. **Scope-ledger lint** (added by C&C 2026-09-22, after a blind comparison: the cheap run's plan
   carried this and the premium plan didn't). A script that reads PLAN.md's Scope ledger and fails if
   a proposal id is referenced anywhere in the plan but missing from the ledger, or vice versa. Build
   it last; it blocks nothing. Acceptance: the script exits non-zero on a deliberately broken fixture
   and zero on the real PLAN.md.

## Files to keep current while building

- `PROGRESS.md` — one dated line per item, what's actually done vs. assumed.
- `DECISIONS.md` — judgment calls made while building, and any real bug found (same discipline
  Sophi-A's own build log already uses).
- A built-log entry per commit, naming the PLAN.md section and the Scope-ledger proposal id(s) it
  serves (PLAN.md's own Scope ledger has every id).
- `BOARD.md` — already written by this run; do not edit it. If a build-time finding contradicts
  something BOARD.md recorded, note the contradiction in `DECISIONS.md` instead of rewriting history.

## What this session must never do

- Build anything PLAN.md §9.2 (Q14) or the Scope ledger marks out of scope (other OS targets,
  multi-provider/local-LLM support, the public release itself, a default-on debate layer, a
  dedicated advisor seat) without a new decision from the owner.
- Attempt corner-session PTY attachment under any name — §4 establishes this is architecturally
  impossible for a terminal the owner opened himself, not a design preference to reconsider.
- Advance §8's falsification-trigger fallbacks past the safest response without the owner's explicit
  authorization for that specific escalation (§10 decision 5).
- Claim the debate mechanism improves outcomes, anywhere, per Fixed Premise 4 (§0, §12).
- Skip an item's acceptance test to move faster. An item is not done until its test passes.

## Available tools

None listed in the request beyond the project's own test suite. Each acceptance test above is run
by hand or via the project's own build/test commands (`cargo test`, `npm test`, the shell scripts
PLAN.md names) — no external reviewer/checker tool is assumed.

## To start

**"Read HANDOFF.md and begin."**

## Edits by C&C (thcmcp-aa), 2026-09-22

The council's handoff is in THCMCP `runs/2026-09-22T16-38-54-363Z/HANDOFF.md`, unedited. This copy got three
changes: item 2 runs after item 1 rather than in parallel, per CLAUDE.md's usage budget; item 4's
gate reference is corrected from item 7 to item 8; and item 7 gets the acceptance test it was missing.
Item 9 (scope-ledger lint) was added later the same day, after the blind comparison.
