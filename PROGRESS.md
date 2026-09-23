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
- 35 tests total (this entry originally said 45 — a miscount, not a later regression;
  corrected 2026-09-22 during item 3 after a direct `node --test` recount: 4 cli + 13
  deriveSnapshot + 5 install + 8 settingsPatch + 5 shim = 35. Now 36 after item 3 added
  one more `deriveSnapshot.test.mjs` case for the rate_limits fix below), `node --test`
  from `reader/`, all passing.

**Acceptance test status (HANDOFF.md item 1): all closed.**
- ✅ "the CLI prints valid JSON with all nine field keys, each carrying a source tag"
  — `reader/test/cli.test.mjs`.
- ✅ "the default run opens no transcript file" — no code path reads one; regression
  test plants a canary and checks the file's `atime`.
- ✅ "a planted canary string is absent from every output" — same test.
- ✅ **2026-09-22, closed for real.** Owner approved installing into his real
  `~/.claude/settings.json` (PLAN.md §10 decision #2); `install.mjs --apply --yes` run,
  additive only (statusLine wrapped with passthrough, 6 hooks added where there were
  none), backed up first. An independent Opus 5 read-only audit and thcmcp-aa's own
  separate check both confirmed the edit safe — see `DECISIONS.md`. The 10-minute live
  capture then ran against this session's own id: valid JSON, all nine keys with
  sources, `observed_at` ~627s after install (a real window, not a re-run), and
  `activityState` reflecting a live hook event rather than a stale install-time value —
  proof the hooks kept firing throughout. One nuance recorded in `DECISIONS.md`: the
  transcript's `atime` did move during the window, traced to this session's own normal
  writes under `relatime`, not to any transcript read — the real guarantee is the
  source-level fact that `zofia-reader.mjs` has no code path that opens a transcript at
  all.

**Item 1 is fully done — closed twice, the second time for real.** thcmcp-aa's
independent read of the first close-out caught two real gaps before item 3 could start:
`docs/field-availability.md` rows 6/8/9 still read "not yet" after the capture had
already happened, and a genuine bug in `deriveSnapshot.mjs` — `rate_limits` and
`rate_limits.five_hour` are two independently-absent things (3 of 5 real sessions had
the former without the latter, all idle at capture time), and the code said "rate_limits
absent" for both cases, which is wrong for the 3-of-5 one. Both fixed: the doc rows now
cite the real captured values, and `deriveSnapshot.mjs` gives each absence case its own
accurate reason string, pinned by a new test. 36 reader tests passing (was 35 before
this fix added one). Full detail in `DECISIONS.md`.

Next: item 3 (wire the reader into the shell) is unblocked — was gated on this real
field matrix, which now exists and is now actually accurate.

## 2026-09-22 — item 2, week 1 Track B: the static shell

**Built and tested against sample data.** Vanilla TypeScript + Tauri v2, kept-unchanged
per PLAN.md §1 row 1 — same build stack Sophi-A already uses (`~/Projects/sophi-a`),
same palette continued (see `src/styles.css`'s own note), ports moved to 1430/1431 so
a concurrent Sophi-A dev server on 1420/1421 isn't clobbered.

- `src/lib/layout/GridShell.ts` + `paneRegistry.ts` — the five-pane shell: fixed top
  bar, four corner state cards (never terminal bytes — PLAN.md §4's confirmed
  architectural fact), a center pane capped at 40vw/40vh, draggable and minimizable.
  Sample data only; `reader` isn't wired in yet (item 3).
- Viewport breakpoints (≥1280 full 2×2, 900-1279 collapses to a 2-pane window, <900 a
  single pane) and session-count overflow (5th+ registered session) share one
  mechanism: a sliding window over all tab entries plus a tab strip, exactly as
  PLAN.md §4 asks ("reusing one mechanism for two different pressures").
- The 480×320px pane floor added mid-session by the C&C edit (`b8acccd`) is
  implemented via `ResizeObserver` on each corner pane, toggling a compact one-line
  card. **Real bug caught and fixed**: the first version measured `contentRect`
  (excludes padding) against a threshold meant for the visible box, so a pane that was
  350px tall read as 318px and wrongly went compact — fixed by observing
  `{box: "border-box"}` instead. See `DECISIONS.md`.
- Accessibility: roving/sequential Tab order across top bar + visible corners + center;
  throttled `aria-live` (1/2s); `rem`-based sizing; WCAG AA contrast (not AAA — the
  first test draft accidentally asserted the stricter AAA rule and had to be corrected,
  see `DECISIONS.md`).
- `test/e2e/shell.test.mjs` — 8 Playwright + axe-core tests against `vite preview`,
  covering the acceptance test literally: the three named viewport sizes, zero
  `.svelte` imports in the built JS, zero AA contrast violations at default and 200%
  zoom, full keyboard reachability, and no raw terminal bytes in corner-pane text.
  **Verified visually too** — screenshots in `test/e2e/screenshots/` (gitignored,
  regenerated by the test run).
- `src-tauri/` — minimal Tauri v2 scaffold (window + frontend load only; no reader/PTY
  wiring yet, that's items 3-4). `cargo check` passes clean. Needed a placeholder app
  icon to compile at all (`src-tauri/icons/*.png` — real design, not the final brand,
  see DECISIONS.md).

**Acceptance test status (HANDOFF.md item 2):** ✅ "renders correctly at the three
viewport sizes §4 names" — `test/e2e/shell.test.mjs`, all 8 passing. ✅ "zero `.svelte`
imports" — same suite, asserted against the actual built JS output.

## 2026-09-22 — item 3, week 2: wire the reader into the shell

**Built and tested; not yet exercised against a real running Tauri window.**

- `src-tauri/src/session_reader.rs` — a Rust port of `reader/src/deriveSnapshot.mjs` +
  `sessionState.mjs`, field-by-field, including the rate_limits two-case fix from item 1
  baked in from the start. Necessary rather than shelling out to the Node CLI: a packaged
  AppImage can't assume a Node runtime. 16 tests, including a fixture-replay test using
  the exact rate_limits-present-but-five_hour-missing shape item 1's live capture found.
- `src-tauri/src/watcher.rs` — a `notify-debouncer-mini` watch (250ms debounce, per
  PLAN.md §2.1) over the sessions directory, emitting a derived snapshot over Tauri's own
  event system for any session_id the frontend has explicitly registered — never for one
  it hasn't, even though the shim writes state for every session on the machine
  (DECISIONS.md, item 1). `register_session` Tauri command also emits immediately on
  registration so a pane isn't stuck on "no snapshot yet" until the next fs event.
- `src/lib/reader/liveWiring.ts` — detects an actual Tauri webview
  (`__TAURI_INTERNALS__`) vs. dev-server/e2e-test context; no-ops outside one, so
  `main.ts`'s sample-data path (item 2, unchanged) still runs under `vite preview` and
  Playwright.
- `GridShell.ts` — a new `refresh()` method for re-rendering after async data arrives,
  and a minimal "Assign session" text input + button per empty corner (PLAN.md §2.1:
  registration is explicit, by the owner's own hand, never auto-discovered). Does not
  persist across a restart — a real gap, flagged in `DECISIONS.md`, not hidden.
- `test/e2e/shell.test.mjs` — 2 new tests (now 10 total): an explicit `UNKNOWN` chip on a
  genuinely-unknown sample field, and the assign-form moving a corner out of "no session
  assigned" into "no snapshot yet."

**Acceptance test status (HANDOFF.md item 3):** ✅ the fixture-replay test — real
shim-shaped fixture data through `derive_snapshot`, `cargo test`'s
`fixture_replay_real_idle_session_shape`. ✅ "corner panes show measured fields and an
explicit UNKNOWN chip for anything the probe didn't confirm" — both the Rust-side
derive-correctness proof and the Playwright DOM-level proof above.

**Not done:** a live launch of the actual Tauri app — verification is `cargo test` (no
GUI) plus Playwright against `vite preview` (not Tauri), so the real
`invoke("register_session", {sessionId})` → Rust `session_id: String` argument-name
conversion has never fired at runtime; it relies on Tauri v2's documented default
camelCase/snake_case convention, not a test that proves it end-to-end. See
`DECISIONS.md`.

## 2026-09-23 — item 7, provider/effort config (zofia-26, builder B)

**Done, part 1 (`50ced01`):** `config/providers.json` is the only authority; the
schema rejects any grok/xAI model id, provider id, alias name, alias target or default
model. The generator writes the gitignored TS and Rust files from it, and `npm run
build`/`build.rs` run it first. Every effort value is `UNKNOWN`, a placeholder for owner
decision 2. Acceptance legs proven by `npm run test:config` (17/17): grok entry → exit
1; TS and Rust id lists identical; no `ALLOWED_PROVIDERS` in `src/`; stale-files lint
fails on an unregenerated edit; every effort value is `UNKNOWN` or tagged to
`docs/field-availability.md`.

**Written, not yet committed, part 2:** `src-tauri/src/provider_guard.rs`, the runtime
rejection (typed id or alias target), independent of the schema. It passes 5/5 compiled
standalone (`rustc --test`), but it isn't in the crate yet: its `mod` line goes into
`lib.rs` in one commit after zofia-8b's item 4 lands, as agreed. Until then the
"runtime rejection fires with the schema bypassed" leg is proven standalone only, and no
spawn path calls it yet (zofia-8b wires it into the center seat's `--model`).

**Not verified:** the `build.rs` "Node not on PATH" error message was read, not
triggered.

## 2026-09-23 — item 9, scope-ledger lint (zofia-26)

**Done (`69e561c`):** `npm run lint:ledger` exits 1 on
`test/lint/fixtures/plan-broken-ledger.md` and 0 on the real `PLAN.md`; `npm run
test:lint` 6/6. The real PLAN.md has three ledger-only ids, reported as warnings (see
`DECISIONS.md`).

## 2026-09-23 — item 4, center seat against a mock (zofia-8b)

**Done (`43fc8f9`):** owned-PTY center seat (`pty_seat.rs`), its Tauri commands
(`center_seat.rs`), the hash sweep (`hash_sweep.rs`), and an xterm.js pane. `cargo test`
44/44, e2e 10/10. Against `test/fixtures/mock-claude.sh`, these pass: typed input arrives
byte for byte, a raw ESC arrives, Ctrl+C arrives as a real SIGINT and the seat survives it,
input/resize/stop aimed at a corner session_id are rejected in the Rust core, a permissive
project settings file blocks launch until confirmed (enforced in Rust), app shutdown stops
the seat and leaves an independent observed process alive, and a scrollback marker is
absent from Zofia's own config/cache/data dirs.

**Pre-reboot fix check:** the uncommitted `PtySeat::stop` was not correct. It sent SIGHUP
only, so a child that trapped SIGHUP survived (reproduced by a test). Fixed; see
`DECISIONS.md`. Folded in four audit findings from `Review/Verify_Items1-3_2026-09-23.md`:
symlink-safe bounded walk, baseline before spawn, process-group kill, env additions.

**Not verified / deferred:**
- The real-CLI tool-policy probe under `cnc-settings.json`. It needs the real `claude`, so
  it waits on item 8. The real CLI is refused in code until then (`REAL_CLI_ALLOWED`).
- "Displayed C&C model equals the owner's selection" waits on item 7 part 2 (the runtime
  guard lands in the crate) and on item 8 (no `--model` goes to a mock).
- The frontend pane has not run in a real Tauri window yet. The e2e suite runs outside
  Tauri, where the placeholder stays. Item 5's real launch covers it, together with the
  missing capabilities file (audit #1).
- The whole-app version of the scrollback grep (only the module level ran).

## 2026-09-23 — item 7 closed; audit fixes #2, #4, #7a, #8 (zofia-26)

- **Item 7 part 2 (`cc09e9a`):** `provider_guard.rs` is in the crate; cargo test 49/49
  (5 its own). Nothing calls it yet: zofia-8b wires it into `center_spawn`'s `--model`
  path, which today launches only the mock and passes no model.
- **#2 (`3e4f44d`):** the shim now replaces `latest_*` keys instead of deep-merging.
  Regression test through both shim scripts and the reader CLI; it fails on the old
  code. The owner's live install runs these repo scripts, so this is already live for
  him. Each stale state file corrects itself on its session's next statusline write.
- **#4 + #8 (`d3868de`):** `UserPromptSubmit` added to the installed hooks; a re-install
  keeps the first record's original statusLine, backup and hook list. Found along the
  way: case-sensitive wrapper detection (see `DECISIONS.md`). Reader suite 39/39.
  **Not done:** re-installing on the owner's real settings. That needs his go.
- **#7a (`50ced01`):** `npm test` runs the e2e files by glob.

## 2026-09-23 — audit fixes #3, #5, #6, #7b, #9 (zofia-26)

- **#5 + #6 + #7b (`9b7117c`):** a snapshot re-render keeps half-typed assign text,
  the caret and focus. Corner cards now show the reset timer, last-active time and
  duration line, each with its chip. The e2e suite builds `dist/` before serving it.
  New e2e tests mock Tauri IPC and fire a real `zofia://snapshot` event; e2e 12/12, and
  all 3 new/changed tests fail on the old GridShell.
- **#3 + #9 (`0e2450b`):** registered sessions are re-derived every 15s, so "stale" and
  dead-PID "ended" appear without a file write. A state file that fails to parse reports
  the parse error instead of "shim isn't installed". cargo test 54/54. **Not
  verified:** the ticker's wiring inside `start_watcher` needs a live Tauri app; only the
  ticker and the re-derive behaviour are tested.

## 2026-09-23 — Rust reader per-field parsing (zofia-26, C&C follow-up to audit #9)

**Done (`43c3704`):** a mistyped value in a session state file now blanks only its own
field, with a "present but mistyped" reason. The rest of the snapshot still renders.
cargo test 57/57, including a mistyped-field fixture test.

## 2026-09-23 — item 6, zero-egress audit: harness (zofia-26)

**Done (`12565ee`):** `npm run audit:egress -- <cmd>` runs the command in an
unprivileged user+net+pid namespace with only loopback, traces the whole process tree's
socket syscalls with `strace -f` for 10 minutes, and writes mock corner activity. `npm
run test:egress` gives 7/7: the classifier on a strace fixture, plus the runner's
namespace, mock-activity, early-exit and verdict plumbing, driven through a stand-in
strace.

**Not done, and it's the actual acceptance test:** the 10-minute run against the
AppImage. `strace` isn't installed (needs the owner's sudo), so the real-strace positive
control skips too. The second §2.3 leg (the real center-seat child's provider traffic,
attributed to its PID) waits on item 8; `--allow-exe` is built for it.

## 2026-09-23 — item 4 audit fixes (zofia-26; `Review/BugAudit_Item4_CenterSeat_2026-09-23.md`)

**Done (`2427f96`), cargo test 64/64:**
- #1: the seat launches with §3's allow-list (`--restricted --tools Read,Grep,Glob
  --strict-mcp-config`). A test asserts the argv the mock actually received.
- #5: the item 8 gate accepts only the committed mock, by content.
- #2: a seat that exits by itself is reaped and its slot freed.
- #3: the settings gate covers `settings.local.json` and decides on presence, not
  readability.
- #4: `TERM` is always xterm-256color.
- #6: the settings files are fingerprinted outside the capped walk, a symlinked
  `.claude` is followed one hop, and the resweep runs async and off the lock.

**Not verified:** whether the real CLI actually refuses each denied tool under these
flags. That's §3's probe, which runs with item 8. The frontend doesn't show
`settings_local_json` yet; that's zofia-8b's `centerSeat.ts`.
**Backlog, unchanged:** the audit's blocking PTY write, the `setsid` escape, confirmation
not tied to content, stop latency, and no `PR_SET_PDEATHSIG`.

## 2026-09-23 — sweep cache, audit backlog, persistence proposal (zofia-26)

- **Sweep cache (`6d2cdb1`):** the 5s resweep re-reads only files whose (dev, ino,
  size, mtime, ctime) changed. An unchanged tree is re-read 0 times, and a same-size
  edit with its mtime reset is still caught.
- **Phase-1 #10 remainder (`5f12f31`):** per-user `/tmp/zofia-<uid>` fallback,
  private-dir check before any write, and session_id validation in the shim, both
  readers and `register_session`. The owner's live dir passes, so live capture is
  unaffected.
- **Item 4 backlog (`ba5ec88`):** non-blocking ordered input queue; setsid'd
  descendants killed on stop; async stop off the lock.
- **Not done, with reasons (`DECISIONS.md`):** `PR_SET_PDEATHSIG`; keystroke order
  across WebKit `invoke`s (needs the real window); confirmation tied to file content
  (needs a `centerSeat.ts` change; asked zofia-8b).
- **Proposal (`01e4452`):** session-assignment persistence, options A/B/C. Waiting on
  the owner.
- cargo test 70/70, reader 41/41.

## 2026-09-23 — audit #1/#10 and item 5, first AppImage (zofia-8b)

**Audit #1/#10 (`327b48d`):** `src-tauri/capabilities/default.json` added
(`core:event:default` only), wiring failures show as a visible alert, `withGlobalTauri`
off, a real CSP. `center_spawn` routes `--model` through `provider_guard`. Proven in a
real window by item 5's smoke: no alert, and live snapshots reach a corner.

**Item 5 (`064659a`):** first AppImage (Fedora 44 x86_64, ~107 MB, `NO_STRIP=true`).
`npm run test:appimage` runs `test/appimage/smoke.mjs` against the packaged artifact in
a clean `fedora:44` image under Xvfb with `--network=none`: **9/9 on the FUSE path, 9/9
via extract-and-run with no FUSE device.** Checked there: the shell renders, no wiring
alert, a synthetic state file's model reaches corner 1, the mock seat launches, paints
its output, shows its model, hides the launcher and echoes typed input, and no seat
process outlives the app. Screenshot reviewed by eye.

**Not verified / not done:**
- Signature verification before launch: waits on the owner's signing key (see TODO).
- Typing goes through xterm's input handler by script, not OS-level key events.
  WebKitWebDriver answers "unsupported operation" to click/send-keys/actions here.
- The host-desktop run couldn't paint, because the session was locked (no compositor
  frames). Every render check comes from the Xvfb container.
- Only Fedora 44 is declared (`packaging/linux-support.md`). No older baseline yet.
- Release extras (checksums, inventory, notices, pinned linuxdeploy) are not started.

## 2026-09-23 — roll-up fixes (zofia-26)

- `d5ac0d2`: the egress harness counts resolver sockets as DNS egress, keeps exe
  attribution across threads and forks, and refuses a window under 600s. test:egress
  10/10.
- `c7c305b`: provider_guard refuses openrouter/auto, x_ai/ and x.ai/. zofia-8b mirrored
  it in the schema (`e96267c`, alongside its effort fix).
- `ef0c6d3`: the seat launches with `sonnet` (decision 4); the mock runs as embedded
  bytes under `/bin/bash`; confirmation is bound to a digest; an exited leader is reaped
  even while a child holds the pty. cargo 72/72, e2e 12/12.
- **Not verified in a real window yet:** all of `ef0c6d3`. zofia-8b's smoke needs a
  rebuild, plus its "CLI default" assertion changed to "sonnet" (told).
