# PROGRESS.md

One dated line per item, what's actually done vs. assumed (HANDOFF.md's own convention).

## 2026-09-22 — item 1, week 1 Track A: the reader spike

**Built, tested, not yet installed anywhere real.**

- `reader/shim/` — `statusline-wrapper.sh` (wraps any pre-existing statusLine command,
  passes its stdout through unchanged) and `hook-writer.sh` (appended alongside
  existing hooks, no wrapping needed there), both writing into a shared per-session
  state file under an `flock`. Manually smoke-tested and covered by
  `reader/test/shim.test.mjs` (5 tests, including a real concurrent-write race).
- `reader/src/deriveSnapshot.mjs` — turns the shim's raw capture into the nine
  `SessionSnapshot` fields, each `{value, availability, source, observed_at}`. 13 unit
  tests (`reader/test/deriveSnapshot.test.mjs`).
- `reader/bin/zofia-reader.mjs` — the CLI. 4 integration tests
  (`reader/test/cli.test.mjs`), including the literal HANDOFF acceptance test: valid
  JSON with all nine keys each carrying a source; a planted canary string absent from
  every output with the transcript file's `atime` unchanged (nothing opened it); the
  no-`--session` path lists registered sessions rather than guessing one.
- `reader/install/install.mjs` + `uninstall.mjs` — reversible, diff-confirmed,
  hash-checked. Defaults to dry-run; `--apply --yes` required to write. 5 integration
  tests (`reader/test/install.test.mjs`) plus 8 pure-logic tests
  (`reader/test/settingsPatch.test.mjs`), including a full install→uninstall
  round-trip and a hash-mismatch refusal when the settings file changed underneath it.
- `docs/field-availability.md` — all nine/ten table rows (see that doc for why the
  count differs from PLAN.md §2.2's literal table) resolved from Claude Code's
  published docs plus the owner's own real, already-working statusline script. **Not
  yet done:** a live 10-minute capture against a real session — see `DECISIONS.md` for
  why, and PLAN.md §10 decision #2 for the actual gate.
- 45 tests total, `node --test` from `reader/`, all passing.

**Acceptance test status (HANDOFF.md item 1):**
- ✅ "the CLI prints valid JSON with all nine field keys, each carrying a source tag"
  — `reader/test/cli.test.mjs`.
- ✅ "the default run opens no transcript file" — no code path reads one; regression
  test plants a canary and checks the file's `atime`.
- ✅ "a planted canary string is absent from every output" — same test.
- ⏳ The spike's own instruction to "run against one real, manually-opened session for
  the full 10-minute window" is not done — needs the owner's go on PLAN.md §10
  decision #2 first (installing into his real `~/.claude/settings.json`).

**Not started yet:** item 2 (the static shell) — HANDOFF.md's own order says wait for
item 1's acceptance test, which mechanically passes; the one open piece (the live
capture) is a documentation-completeness item, not a code-acceptance blocker, but it's
flagged to the owner rather than silently treated as "done enough."
