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

## 2026-09-22 — item 2 (static shell)

**PLAN.md and HANDOFF.md changed on disk mid-session, from another live session on
this same machine.** `git log` showed four new commits (`573362b`…`b8acccd`) land
between when this session started and when item 1 was committed, none of them mine.
The last one (`b8acccd`) is a genuine C&C edit adding §4's pane floor (480×320px) and
a "cost of being wrong" appendix — consistent with `FOCUS.md`'s own description of
cnc-harness-0e finishing the HANDOFF/PLAN copy-in concurrently. Re-read both files in
full before starting item 2 rather than building against a stale copy; the pane floor
is incorporated below. Worth naming because it could easily have gone unnoticed — file
sizes changed but no system notice flagged it the way CLAUDE.md's/FOCUS.md's own edits
were flagged.

**Reused Sophi-A's exact build-tool versions (Vite ^8.0.16, TypeScript ~6.0.3,
@tauri-apps/cli ^2) rather than picking current latest.** PLAN.md §1 row 1 calls the
Tauri+vanilla-TS stack "kept-unchanged" — read as continuity with the actual toolchain
Sophi-A already runs, not just the architecture. Same reasoning for reusing Sophi-A's
CSS custom-property palette (`~/Projects/sophi-a/src/styles.css`) rather than inventing
a new one: same owner, same eventual license, already accessibility-considered (its own
comment: "icon+label+color always together, never color alone"). Dev server ports moved
1420/1421 → 1430/1431 so a concurrently-running Sophi-A dev server isn't port-blocked.

**Real bug: `#app` vs `body` as the flex container.** First CSS draft put
`display:flex; flex-direction:column` on `body`, but Vite mounts into `<div id="app">`,
which is `body`'s only child — `#topbar`/`#shell` are `#app`'s children, not `body`'s,
so the flex rules silently did nothing and `#shell` rendered at 0 height. Caught by the
first Playwright test run (`page.waitForSelector` timed out because `#shell` resolved
to a hidden 0-height element) — fixed by moving the flex container to `#app`. Left as a
reminder for any future Vite-mounted app in this repo: the flex/grid root almost always
needs to be the mount div, not `body`.

**Real bug: pane-floor measured content-box, not border-box.** `ResizeObserver`'s
default `contentRect` excludes padding; the 480×320 threshold from `b8acccd` reads as
describing the pane's actual visible size (what you'd see/measure on screen), so a pane
rendering at 350px tall (318px content height after 2×16px padding) wrongly tripped the
floor and showed the compact one-line card instead of the full one — at a viewport size
nowhere near small. Caught by inspecting a real screenshot, not by the automated tests
(none of the 8 asserted on full-vs-compact card content). Fixed by observing
`{box: "border-box"}` and reading `entry.borderBoxSize` instead. **Gap this leaves**:
no automated test currently pins "full card renders at typical corner-pane sizes" — a
future regression here would need another visual check to catch, same as this one was.

**Real bug (test-only): first axe-core check asserted WCAG AAA, not AA.** Ran
`runOnly: ["cat.color"]`, which pulled in `color-contrast-enhanced` (AAA, 7:1) alongside
`color-contrast` (AA, 4.5:1/3:1) — PLAN.md §4 asks for AA specifically. The palette's
muted text (6.5:1 on `--surface`) genuinely clears AA with margin; it just isn't AAA.
Fixed the test to `runOnly: ["color-contrast"]` only. Not a design defect, a test
over-scoping bug — recorded because it's the kind of thing worth getting right next
time rather than loosening a real check to make it pass.

**Tab-strip sliding-window design for the collapsed/overflow cases wasn't fully spelled
out in PLAN.md §4** ("1×2 plus a tab strip" for the medium breakpoint, "the same tab
strip" for 5th+ overflow sessions) — implemented as: always 4 conceptual tab entries
(the fixed corner slots, empty ones included) plus overflow, a `windowSize` per
breakpoint (4/2/1), and a sliding `windowStart` that a tab click moves into view.
Chosen because it's one mechanism serving both pressures (viewport and session count)
exactly as the plan asks, defaults to the literal "all 4, no tabs" case when neither
pressure applies, and needed no separate pagination concept for overflow. Flagging as a
judgment call, not a plan quote, since the plan didn't fully specify the mechanics.

**Placeholder app icon generated, not designed.** `cargo check` refused to compile
without one (`tauri::generate_context!()` panics if `icons/icon.png` is missing), and
separately refused a plain RGB PNG — Tauri's icon loader requires RGBA, 8-bit depth
specifically (a 16-bit RGBA export from ImageMagick's default also failed). Generated a
simple gold-circle-on-dark placeholder from the shell's own palette
(`src-tauri/icons/*.png`) purely so the scaffold compiles; this is not a real app icon
and should be replaced with actual visual design before any real release.
