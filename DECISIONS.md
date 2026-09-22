# DECISIONS.md

Judgment calls made while building, and any real bug found — same discipline Sophi-A's
own build log uses. One dated entry per decision; never rewritten, only added to.

## 2026-09-22 — item 1 (reader spike)

**Abandoned driving a real, spawned `claude` process for the live 10-minute
measurement.** The original plan was to spawn an isolated `claude` subprocess under a
pty (via `--settings`/`--setting-sources`, never touching the real
`~/.claude/settings.json`) and feed it scripted prompts so the shim would capture real
statusline/hook traffic without needing the owner present. The auto-mode safety
classifier blocked the write ("Create Unsafe Agents") — and on inspection it was right
to: `CLAUDE.md`'s own rule only authorizes Zofia spawning-and-injecting-input for the
center seat, tested against a mock (HANDOFF item 4), not as a measurement probe for the
observation bridge. The observation bridge is supposed to passively watch a session
*the owner runs himself*; programmatically driving a synthetic one is a different thing
than what item 1 asked for, not a workaround for it. **Consequence:** the live capture
against a real session is still outstanding. It needs the shim actually registered in
`~/.claude/settings.json`, which is gated on PLAN.md §10 decision #2 anyway (the owner
confirming the install doesn't conflict with what he's already got configured) — so
this isn't a shortcut lost, it's the same gate the plan already named, arrived at from
a different direction.

**What stands in for it instead.** `docs/field-availability.md`'s "measured" values
come from two primary sources: Claude Code's own published statusline/hooks reference
docs (fetched 2026-09-22), and the owner's own real, already-installed, already-working
`~/.claude/statusline-command.sh`, read (not executed, not modified) to confirm four of
the fields empirically against his actual CLI version (2.1.280). That's real evidence,
not a guess — but it is not the same as watching a live 10-minute session, and the doc
says so plainly rather than blurring the two.

**Field-key count: nine, not the ten rows PLAN.md §2.2's table literally has.**
HANDOFF.md says "nine field keys" three times; the plan's own table has ten rows
because it lists "Token spend (USD)" and "Token spend (token counts)" separately.
Reconciled by making `tokenSpend` one top-level key with two sub-fields (`usd`,
`tokens`), each carrying its own provenance — satisfies HANDOFF's literal acceptance
test while still honoring the plan's "never conflate USD with token counts" rule
structurally rather than by having two flat keys.

**The opt-in transcript-JSONL fallback isn't built at all, not just left disabled.**
PLAN.md §2.1 anticipated needing it if week 1 found a field only the transcript could
answer. It doesn't: context%, token counts, and the duration line all resolved without
it (see `docs/field-availability.md`). Building an unused, privacy-sensitive code path
"just in case" would be exactly the kind of scope this project's own discipline argues
against. If a later field genuinely needs it, PLAN.md §9.2 item 6 still requires it
ship opt-in and off by default.

**Reader CLI written in plain JavaScript (Node ESM), not TypeScript.** The disposition
ledger's "vanilla TypeScript" commitment (PLAN.md §1, row 1) is about the GUI shell
frontend, not this standalone spike tool — and PLAN.md §2.1 already expects the
mechanism to move into a Rust `inotify` watcher once the GUI exists. Adding a build
step for a tool likely to be superseded wasn't worth it. Revisit if the reader CLI
ends up living longer than expected.

**Real bug caught while writing tests, not in shipped code:** `child_process.execFile`'s
async form has no `input` option — that's sync-only (`execFileSync`). The first draft
of `reader/test/shim.test.mjs` passed `input` to the async `exec()`/`execFile()`
anyway; it was silently ignored, so the shim scripts' own `cat` (reading stdin) blocked
forever and every test in that file hung with no output at all. Fixed by writing to
the child's `stdin` and calling `.end()` explicitly via `spawn`. Left here because it's
exactly the kind of thing worth remembering next time a shell script under test needs
stdin from Node.

**`install.mjs --apply` has never been run against the real `~/.claude/settings.json`.**
Every test uses `--settings-path` pointed at a temp file. Running it for real is the
owner's call (PLAN.md §10 decision #2) — asked in chat, not assumed.
