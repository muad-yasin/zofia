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

## 2026-09-22 — item 1 (reader spike), install applied for real

**`install.mjs --apply --yes` was run against the real `~/.claude/settings.json`**, superseding
the note above that it never had been. Owner's go given in chat (PLAN.md §10 decision #2). Change
was additive only — statusLine wrapped (original command preserved via
`ZOFIA_ORIGINAL_STATUSLINE_CMD`, output passthrough), six hook events added where there were
previously zero. Original backed up to `~/.claude/zofia/settings.json.<ts>.bak` before the write.
An independent Opus 5 read-only audit afterward (diff scoped to exactly those two keys, statusline
byte-identical output, hook script never hangs on empty/garbage stdin, install-record sha256
matches the live file, no secrets touched) found it safe. thcmcp-aa separately verified the same
facts from its own session and relayed to the owner.

**Once installed, the shim observes every Claude Code session on the machine, not only the ones
Zofia's own shell UI displays.** The hooks and statusLine wrapper live in the one shared
`~/.claude/settings.json`, so any session process reads them — there is no per-session opt-in and
no filtering by which sessions Zofia happens to be showing. Confirmed in practice: the capture
directory picked up all five sessions that were running at install time, including this build
session and unrelated peer sessions, not a chosen subset. Worth stating plainly (flagged by
thcmcp-aa's independent check) because it's a real scope fact for the privacy requirement in
`CLAUDE.md`, not just an implementation detail — anyone deciding whether to run the installer
should know it's machine-wide, not opt-in per session.

**The live 10-minute capture ran for real, against this session's own id
(`d55b834d-d581-4891-9429-5afbe96e9f96`), closing item 1's last open acceptance test.**
`zofia-reader.mjs --session <this session>` returned valid JSON with all nine keys (`tokenSpend`
counted once per the earlier reconciliation), each with a `source`, `observed_at` timestamps ~627s
after install — genuinely spanning the window, not a re-run snapshot — and `activityState`
correctly reflecting the most recent real hook event (`PreToolUse` / Bash) rather than a stale
install-time value, proving the hooks kept firing live throughout, not just once at install.

**One real nuance caught while checking the "opens no transcript file" claim against a live
session, not the test fixture.** The transcript's `atime` did move during the window (baseline
vs. after), which looked at first like a regression. It isn't: `stat` shows `mtime` newer than the
new `atime`, the filesystem is mounted `relatime` (`findmnt`), and this session's own Claude Code
process was continuously appending to that same transcript file throughout the window for
unrelated reasons (normal conversation logging) — under `relatime`, a write bumps `atime` forward
whenever it was older than `mtime`, independent of any read. Confirmed by source inspection that
`zofia-reader.mjs` has no code path that opens a transcript file at all (stated in its own header
comment). **Consequence:** the atime check in `reader/test/cli.test.mjs` is a clean signal against
a static fixture (nothing else touches that file), but is not a reliable signal on a live,
actively-written real session — the source-level guarantee (no transcript-reading code path) is
what actually proves the claim there, not atime-watching. Worth remembering if a future check
tries to verify "nothing read this file" against a real session again.

**thcmcp-aa's independent read of the same close-out caught two real gaps, both
confirmed against the repo before fixing.** (1) `docs/field-availability.md` rows 6, 8,
9 still said "not yet — doc-only until a live capture" after the capture had already
happened; HANDOFF item 1's instruction to fill the nine rows with real measured values
is separate from the acceptance test passing, and the close commit only touched
DECISIONS.md/PROGRESS.md. Fixed: rows 3, 4, 6, 8, 9 now cite the real captured values
(`cost.total_cost_usd: 18.13…`, `context_window` token counts, a live `PreToolUse`/`Bash`
hook event), and the file's intro/"still open" sections no longer say the capture hasn't
happened.

(2) **Real bug in `deriveSnapshot.mjs`, not just a doc gap**: `rate_limits` and
`rate_limits.five_hour` are two independently-absent things. Measured across the 5 real
sessions the 2026-09-22 capture touched: 3 had `rate_limits.seven_day` present with
`five_hour` missing (all three idle at capture time), 2 had both (the two sessions with
recent activity). `deriveRateLimitPct`/`deriveRateLimitReset` only ever said "rate_limits
absent" regardless of which case it was — factually wrong for the 3-of-5 case, where
`rate_limits` plainly exists. Fixed with `describeRateLimitAbsence()`, which checks
`rate_limits` presence separately from `rate_limits.five_hour` presence and gives each
case its own accurate reason string; a new test
(`deriveSnapshot.test.mjs`: "rate_limits present but five_hour missing") pins the
distinction. **What isn't known yet**: what actually brings `five_hour` back — a fresh
API response in that session is the leading guess from the pattern observed (idle
sessions lack it, active ones have it), not a confirmed trigger. Recorded as open in
`docs/field-availability.md` rather than asserted.

## 2026-09-22 — item 3 (wire the reader into the shell)

**Field-deriving logic lives in Rust too, not reused from `reader/src/deriveSnapshot.mjs`
directly — a deliberate duplication, not an oversight.** The packaged GUI binary can't
shell out to the Node-based reader CLI without bundling a Node runtime into the AppImage,
an undocumented dependency §6 (Linux packaging) never accounted for or tested against.
`src/lib/layout/types.ts` already flagged this split during item 2 ("the reader is a
standalone Node CLI and this is the browser-side shell... they're deliberately not the
same build"), and PLAN.md §2.1 itself anticipates "the mechanism moves into a Rust
`inotify` watcher once the GUI exists." So `src-tauri/src/session_reader.rs` ports every
derive rule field-by-field, including the rate_limits two-case fix above baked in from
the start, with its own mirrored test suite (16 tests, `cargo test`) rather than trusting
parity by inspection. **Real risk this creates, named rather than hidden:** two
codebases now implement the same rules; a future change to one without the other is a
real bug class, the same shape as the `ALLOWED_PROVIDERS` hand-sync drift PLAN.md §5
already cites as a lesson. Mitigation is discipline, not tooling, for v1 — both files'
header comments point at each other.

**Real bug caught by `cargo test`, not by design: `ZOFIA_SESSIONS_DIR` is process-wide
env state, and Rust's test runner runs tests in parallel by default.** Three tests
touching that env var raced each other nondeterministically (one run failed, `fixture
must be found`, on the first `cargo test` invocation; passed on retry). Fixed by a
`static Mutex<()>` those three tests lock first, serializing only themselves — not the
whole suite. Left as a reminder: any future Rust test touching this env var needs the
same lock, the same class of hazard `reader/test/shim.test.mjs`'s stdin bug already
represents for this project (a real bug found by the test harness itself, not the code
under test).

**Chose a minimal "Assign session" form over either (a) no assignment UI or (b) a full
session-picker.** PLAN.md §2.1 requires registration be "explicit, never automatic
discovery — the owner assigns a detected session_id to each corner pane by hand," and
HANDOFF's own CLI precedent (`zofia-reader.mjs`'s no-`--session` behavior: list what
exists, let a human pick) implies a real assignment mechanism, not just backend plumbing
nobody can trigger. But PLAN.md never specs a picker UI (no discovery-list design,
no persistence-across-restart story), and building one now risks exactly the
undisciplined scope-add HANDOFF's "what this session must never do" list warns against.
Landed the smallest thing that's genuinely usable: a text input + button per empty
corner, native and keyboard-accessible for free, calling the same `register_session`
Tauri command the whole pipeline already needed. Session assignment does not persist
across a restart — out of scope here, flagged for whenever item 3's UI gets revisited.

**Not done: a live launch of the actual Tauri app.** Verification for this item is
`cargo test` (16 tests, including a fixture-replay test using the real
rate_limits-present-but-five_hour-missing shape from item 1's live capture) plus
Playwright e2e against the built frontend (10 tests, 2 new: an explicit UNKNOWN chip on
a genuinely-unknown field, and the assign-form moving a corner out of "no session
assigned"). Both run outside a real Tauri webview by construction (`cargo test` has no
GUI; `vite preview` isn't Tauri), so neither exercises the actual `invoke("register_session",
{sessionId})` → Rust `session_id: String` argument-name conversion at runtime — this
relies on Tauri v2's documented default camelCase-JS/snake_case-Rust convention, not a
test that proves it end-to-end. Same posture item 1 already used for the honest-not-yet
gate: named here rather than asserted as covered by the tests that do run.

**Real bug (docs, not code): `BUILT.md`/`PROGRESS.md`'s item 1 entry both claimed "45
tests total."** A direct `node --test` count from `reader/` gives 35 (before this item's
own +1 test), not 45 — 4 (cli) + 13 (deriveSnapshot, now 14) + 5 (install) + 8
(settingsPatch) + 5 (shim). Pre-existing inaccuracy from whoever wrote that line
originally, not something this item's changes caused; corrected in `PROGRESS.md`/`BUILT.md`
rather than left to compound.

## 2026-09-23 — owner decision 4 resolved (`PLAN.md` §10, item 4's C&C model)

**The owner's own words, relayed by thcmcp-aa (the C&C seat) from the C&C chat, not
typed directly into this session:** *"C&C model is Sonnet, latest build."* Read as: the
center seat launches with Claude Code's own `sonnet` alias (matches the real
`~/.claude/settings.json` shape already seen during item 1's install — `"model":
"sonnet"`, not a pinned dated snapshot id), always resolving to whatever Sonnet build is
current, not a fixed model id frozen at build time. This is a relay of a decision, not a
work instruction — `HANDOFF.md`'s own order still governs what gets built and when;
recording the fact now doesn't start item 4 early. thcmcp-aa independently re-verified
the last two commits (`75c34e7`, `d0e901e`) against the repo before relaying — 36/36
reader and 16/16 Rust tests, and confirmed the hygiene commit deleted nothing and
changed no code — consistent with what this session already knows to be true.
Recorded here per PLAN.md §5's own rule ("the owner picks the C&C model... the plan
states this as an owner decision, never a security or quality claim") and cross-updated
in `ROADMAP.md`/`TODO.md`/`TODO-Archive.md`. The concrete config value (whatever
`config/providers.json`/the launch-settings key actually needs to say for "sonnet,
latest") is item 4's own build work, not written here — this entry records the decision,
not the implementation.

## 2026-09-23 — items 7 and 9 (zofia-26, builder B)

- **Item 7: the schema validator is hand-written, not ajv.** It has zero dependencies
  and implements only the keywords `providers.schema.json` uses. It throws on any
  other keyword, so the schema can't rely on a rule that is silently not enforced.
- **Item 7: `build.rs` now needs Node on PATH.** It generates the gitignored
  `src-tauri/src/generated/providers.rs`, so a fresh clone's `cargo test` works. Without
  Node it panics with a message saying so (zofia-8b's request).
- **Item 7: all effort values ship as `UNKNOWN`.** `docs/field-availability.md` row 2
  proves effort is *exposed*, but not which levels exist per model, or which key a
  CLI-spawned seat's effort goes in. Nothing was invented. Owner decision 2 fills them
  in, each tagged `docs/field-availability.md#…`.
- **Item 7: the models are the CLI's own aliases** (`sonnet`, `opus`, `haiku`), and the
  default is `sonnet` per owner decision 4. The runtime guard lets unknown ids through,
  because the CLI accepts full model ids. It enforces only the xAI/Grok rule, and it
  also rejects non-ASCII ids so a lookalike "grоk" (Cyrillic о) can't pass.
- **Item 9: ledger-only ids are a warning, not a failure.** HANDOFF says "or vice
  versa", but the real PLAN.md has three ledger entries never cited outside the ledger
  (GEMINI38FLASH-1, MUSESPARK12-1, QWEN38MAX-2). A hard failure would contradict the
  same item's "exit zero on the real PLAN.md". `--strict` makes them errors. PLAN.md
  was not edited (it's the council's plan). Whether to cite those three in the body, or
  keep the warning, is for C&C and the owner.
- **Process note:** C&C's instruction to fix the item 1-3 audit regressions *before*
  item 9 arrived after item 9 was already committed. The regressions are next.

## 2026-09-23 — item 4 (zofia-8b, builder A)

- **Real bug: portable-pty 0.9's cloned `ChildKiller` sends SIGHUP only.** Read in the
  crate source (`ProcessSignaller::kill`): no escalation. Only `Child::kill` on the child
  itself escalates to SIGKILL. The pre-reboot `stop()` used the cloned killer, so a child
  that trapped SIGHUP survived. **Don't go back to the cloned killer.** `stop()` now sends
  SIGHUP to the process group, waits 5s, then SIGKILLs the group and confirms the exit.
- **The whole process group is signalled, not only the leader pid.** portable-pty starts
  the child with setsid, so pid = pgid. A real CLI's tool subprocesses would otherwise
  outlive the seat. The group gets SIGKILL even after a polite exit, so members that
  ignored SIGHUP don't survive. Guarded against pgid <= 1.
- **Transport is Tauri IPC, not a WebSocket.** PLAN.md §3 carries over Sophi-A's
  "WS token + allowed-origins gate". That gate protects a WS listener, and Zofia opens
  none: commands in, events out, over the same authenticated channel item 3 uses. No port
  means nothing to gate, and less for item 6's zero-egress audit to explain.
  `tokio-tungstenite`/`futures-util`/`getrandom` were dropped from the pre-reboot
  Cargo.toml. If a WS path is ever added, the gate comes with it.
- **The center seat's env allowlist adds `XDG_RUNTIME_DIR` and
  `DBUS_SESSION_BUS_ADDRESS`** (audit finding). Without them, runtime files fall back to
  shared /tmp and a keyring credential store is unreachable. Both are what the owner's own
  terminals pass to `claude`, so this widens nothing beyond a normal terminal. `DISPLAY`
  and `WAYLAND_DISPLAY` stay out.
- **The real `claude` is refused in code until item 8** (`center_seat::REAL_CLI_ALLOWED`,
  checked by basename). The seat launches only `ZOFIA_CENTER_COMMAND` (the mock).
- **The foreign-settings confirmation is enforced in Rust** (`launch_gate`). A frontend
  that skips the dialog still can't launch.
- **Hash sweep bounds** (audit finding): symlinks are fingerprinted by target and never
  followed. A top-level `CLAUDE.md` link also hashes its target file, one hop, because
  Claude Code reads through it. The walk caps at depth 8 and 2,000 entries, with a
  deterministic `~truncated` marker. Files over 1 MiB are fingerprinted by size and mtime.
  The baseline is taken before spawn, so a write at startup counts as a change.
- **xterm.js 6** with `@xterm/addon-fit` 0.11 (the pair released together).

## 2026-09-23 — audit fixes #2, #4, #8 (zofia-26)

- **Real bug, found while fixing #8:** `computeInstallPatch` recognised its own
  statusLine wrapper by a case-sensitive `"zofia"` match. The owner's checkout is
  `~/Projects/Zofia`, so any re-install there wrapped the wrapper a second time. Fixed
  (case-insensitive, anchored on `/statusline-wrapper.sh`). His live settings are wrapped
  once today, so it never fired for real.
- **Correction (same day):** an earlier version of this entry said the owner's live
  `install-record.json` lists 0 injected hooks. That was a misread: a jq filter of mine
  piped `.original_statusline` into the hook count. The record has all 6 hooks, matching
  his settings, so his uninstall works as designed. thcmcp-31 caught it. Nothing under
  `~/.claude` was written.
- **#2: the merge is top-level `+`, not a per-key rule.** Each shim writer owns exactly
  one top-level key, so replacing whole keys is correct, and it also stops stale
  `cost.*`/`context_window.*` sub-fields, not just `five_hour`.
- **The real-`claude` refusal is an accident guard, not a security boundary.** It
  compares the command's basename only, so a wrapper script under another name gets
  through. It exists so nobody launches the real CLI by mistake before item 8. The owner
  sets `ZOFIA_CENTER_COMMAND` himself, and nothing here defends against him.
- **`--model` goes through `provider_guard::check_model`** (item 7, `cc09e9a`) in
  `center_spawn`. The resolved id is what gets launched, and the pane shows it.
  No selection means no `--model` at all, and the pane shows "CLI default".
- **Audit #1 and #10:** `src-tauri/capabilities/default.json` grants only
  `core:event:default` to the `main` window. App commands need no grant, and each one
  checks its own input in Rust. `withGlobalTauri` is off (the frontend imports
  `@tauri-apps/api`), and the CSP went from `null` to `'self'` with inline styles
  (xterm.js needs them) and the IPC origins. `main.ts` now shows a wiring failure as a
  visible alert instead of `void`-ing it.

## 2026-09-23 — audit fixes #3, #5, #6, #9 (zofia-26)

- **#3: tick every 15s, not every 120s.** 120s is the stale *threshold*. Ticking at the
  same interval would let a dead session read "running tool" for up to ~240s. 15s
  is a placeholder; each tick reads one small tmpfs file per registered session.
- **#6: absolute clock times, no "Ns ago".** A relative label is only true at render
  time, and renders now happen every 15s. That's close, but it would still present a
  derived number as a live measurement.
- **#5: carry state across the rebuild; no keyed DOM diffing.** It's the smallest
  change that fixes the bug. `renderCorners` still rebuilds every corner.
- **#9, still open:** the Rust reader's serde types are strict, so one mistyped field
  (e.g. `resets_at` as a float) blanks the *whole* snapshot. The Node reader
  parses the same file and derives the other fields, so the two readers still differ
  on type mismatches. The error is now at least named correctly. Per-field tolerant
  parsing is a separate change, not made here.

## 2026-09-23 — Rust reader per-field parsing (zofia-26)

- **Resolves the "#9, still open" note above.** Instead of per-field `deserialize_with`
  wrappers, the parser runs a type check against a path table, then does the existing
  strict deserialize. The derive functions are unchanged, and the table is one place to
  read the schema.
- **Numbers:** integer fields (epochs, token counts) accept any finite number, floored.
  The Node reader accepts any number there, and a float epoch is the same instant, so
  this isn't a guess. A string or object is refused.
- **Remaining difference, wording only:** for a mistyped value the Node reader says "not
  yet observed", and the Rust reader says "present but mistyped". Both show UNKNOWN.

## 2026-09-23 — item 6 harness (zofia-26)

- **strace, not a home-made tracer.** `strace` and `Xvfb` are missing, and gcc/ptrace
  would allow a custom tracer. But a hand-written ptrace tracer is exactly the kind of
  checker that needs its own audit. `strace -f` is the standard tool, and the owner can
  install it with one command.
- **The PID tree is scoped twice.** `strace -f` follows every fork/clone, and a private
  PID namespace means nothing the app spawns can outlive or leave the traced run.
  Leftovers die with the namespace.
- **Port 53 on loopback counts as egress.** Inside the namespace, a DNS query to
  systemd-resolved's 127.0.0.53 looks like loopback, but outside it the lookup would
  leave the machine.
- **Known blind spot, listed rather than hidden:** a unix-socket request to a local
  daemon (D-Bus, portals) could make that daemon connect out on the app's behalf. No
  syscall trace of the app's tree can see that. The report lists every unix socket
  path contacted, for a person to review.
- **Early exit is INCONCLUSIVE.** An app that crashes at startup sends nothing, and that
  must not read as a pass.

## 2026-09-23 — item 4 audit fixes (zofia-26)

- **The tool policy uses the CLI's own `--restricted`.** `claude --help` (2.1.280) says
  it drops the code-running tools and WebFetch, ignores user/project/local settings
  files, confines file tools to the workdir, and refuses `bypassPermissions`. That's
  §3's "merged settings can't widen the policy" concern, handled by the vendor. `--tools
  Read,Grep,Glob` is the allow-list, and `--strict-mcp-config` with no `--mcp-config`
  means no MCP. Only `--help` was read; no session was started. The flags are
  documented, not measured: `docs/cnc-tool-policy.md` stays item 8's probe output.
- **The item 8 gate matches content, not path.** A path allow-list would break the
  podman smoke image, which mounts the repo at `/zofia`. Comparing the file's bytes to
  the compiled-in mock works anywhere, and a symlink or rename can't turn the real CLI
  into "the mock". Known window: the file could change between the check and the exec.
  That's acceptable for a pre-item-8 dev gate, and this note records it.
- **The resweep's cost remains.** Moving it off the main thread and off the lock fixes the
  freezes. With workdir = $HOME it still hashes ~70 MiB every 5s. Caching by mtime is a
  possible follow-up, not done.

## 2026-09-23 — PROPOSAL for the owner: should corner assignments survive a restart? (zofia-26, no code)

**The gap (TODO.md):** each corner's session_id is typed by hand and lost when the GUI
closes. PLAN.md §2.1 wants registration to be deliberate, never auto-discovery. Its own
wording is "the owner assigns a *detected* session_id to each corner by hand".

**Facts that bound the choice.** Session state files live on tmpfs
(`$XDG_RUNTIME_DIR/zofia/sessions`) and are gone after a reboot. Unverified: whether a
resumed Claude Code session keeps its old id. If it doesn't, any saved id is dead after
a reboot anyway.

| | A. Don't persist; offer a picker | B. Persist until reboot (recommended) | C. Persist on disk |
|---|---|---|---|
| Where | nothing stored; the assign box lists the ids that have a state file right now | `$XDG_RUNTIME_DIR/zofia/assignments.json`, next to the session files (0600, dir 0700, tmpfs) | `~/.config/de.sower.zofia/assignments.json` (0600) |
| Format | none | `{"version":1,"corners":[{"corner":0,"session_id":"<uuid>","label":"…","assigned_at":<epoch>}]}`, written atomically on every assign or clear | same as B |
| Survives | nothing | a GUI restart or crash, not a reboot: the same lifetime as the data it points at | everything, including ids that are long dead |
| "Deliberate" | every launch is a fresh choice, but one click instead of pasting a UUID | the owner's choice is restored, not remade, and marked "restored" with a one-click "clear all" | as B, but it resurrects choices from past boots |
| Privacy | lists session file names (UUIDs) only, never their contents; nothing new is stored | ids plus the labels he typed, in RAM-backed storage, gone at shutdown; no content | the same metadata, kept on disk indefinitely: a record of which sessions he watched, and when |
| Cost | small UI change; Rust lists the directory | a small Rust read/write plus restore-on-start; the tests are easy | as B, plus a stale-id story |

**Recommendation: B, with A's picker as an optional extra.** B fixes the actual annoyance
(retyping after a GUI restart). It stores nothing that outlives the session files
themselves, and restoring is visible and reversible, so registration stays deliberate.
C buys only surviving a reboot, where the ids are probably stale, and it's the only
option that writes this metadata to disk. A alone is the most conservative choice if
the owner wants every launch to be a fresh choice.

**Needs the owner:** pick A, B, B+A or C. Nothing is built until he does.

## 2026-09-23 — sweep cache and item 4 backlog (zofia-26)

- **The cache key includes ctime.** (size, mtime, inode) alone would skip a same-size
  edit whose mtime was reset, and C&C asked for exactly that case to be caught. The
  kernel moves ctime on every write and on every mtime reset, and setting ctime back
  takes root or a clock change. That's the residual limit, accepted.
- **No `PR_SET_PDEATHSIG`.** portable-pty's CommandBuilder has no pre-exec hook, and a
  `setpriv --pdeathsig` wrapper ties the child's life to the *thread* that forked it,
  which for a Tauri command isn't guaranteed to be long-lived. That would risk killing a
  healthy seat. Not fixed. A GUI crash can still leave the seat running until its PTY
  hangs up.
- **The setsid fix is partial by nature.** Descendants are found through /proc parent
  links at stop time. One that was already orphaned (a double-forking daemon) is out of
  reach. Only a cgroup scope (e.g. `systemd-run --user --scope`) would hold it: a
  bigger change, left for later.
- **A full input queue refuses instead of blocking.** A child that stops reading gets
  new input dropped with an error the frontend can show, instead of freezing the GUI.

## 2026-09-23 — item 5 (zofia-8b)

- **`NO_STRIP=true` for the AppImage build.** linuxdeploy's bundled `strip` fails on the
  `.relr.dyn` sections of Fedora 44's libraries. Skipping the strip gives a bigger
  artifact, not a broken one. `npm run build:appimage` sets it.
- **The declared baseline is Fedora 44 x86_64 only.** A build on Fedora 44 needs
  glibc 2.43. PLAN.md §6 forbids claiming more than was tested, so wider support means an
  older build container plus a clean-image run per distribution.
- **The smoke drives the DOM by script.** WebKitWebDriver (webkitgtk6.0 2.52.5) refuses
  element click/send-keys and the Actions API with "unsupported operation", on Wayland
  and XWayland alike. Terminal text enters through xterm's own `input` handler, so it
  covers onData -> IPC -> Rust -> PTY, but not OS-level keyboard delivery. Stated in
  `test/appimage/webdriver.mjs`.
- **Render checks run only under Xvfb.** On the host, the owner's desktop was locked
  (`LockedHint=yes`): no frames, so `requestAnimationFrame` never fires and xterm never
  paints, even though the bytes arrive (the pane's byte counter showed 19). It's
  environmental, but it would look like a Zofia bug, hence this note.
- **The AppImage embeds the mock's bytes** (zofia-26's content gate, `2427f96`), so any
  mock edit needs a rebuild before a container run.
- **A byte counter on the terminal host** (`data-bytes-in`): a count only, never content.
  It tells "no events" apart from "not painted".

## 2026-09-23 — correction to the decision-4 entry, and roll-up fixes (zofia-26)

- **Correction (dated, the entry above is left as written):** the decision-4 entry says
  the owner's `~/.claude/settings.json` shows `"model": "sonnet"`. It shows `opus[1m]`
  (C&C checked; roll-up 2026-09-23). The decision itself stands: the center seat
  launches with `sonnet`. The wrong parenthetical mattered. Until `ef0c6d3` the seat sent
  no `--model`, so it ran his `opus[1m]` default, never Sonnet. Rust now falls back to
  `config/providers.json`'s default.
- **Item 8 gate: never execute the disk file.** Content-matching the file still let a
  PATH-planted `bash` run instead (the mock's `#!/usr/bin/env bash`), and left a
  window between the check and the exec. Running `/bin/bash -c` on the compiled-in bytes
  removes both. The disk file only signals intent.
- **Confirmation = digest.** The owner confirms the exact bytes the dialog showed;
  any change since then needs a new confirmation.

## 2026-09-23 — OWNER DECISION: session-assignment persistence = option B

**Muad's words, relayed by C&C (thcmcp-31):** *"Idk a b or c, but temporary folder
sounds fine."* Read as option B from the proposal above:
`$XDG_RUNTIME_DIR/zofia/assignments.json`, restored across a GUI restart, gone at reboot,
restored corners marked "restored", with a one-click "clear all". No picker (option A's
extra wasn't asked for).

## 2026-09-23 — OWNER DECISION 2: center-seat default effort = Medium

**Muad's words, relayed by C&C (thcmcp-31), not typed into this session:** *"I'd go with
Medium as the default"*. The board (`~/Projects/FOCUS.md`) has the same call: "Zofia
decision 2: effort default = Medium".

- `config/providers.json` gets `default_effort: medium`, sourced to this entry. The
  generator emits `DEFAULT_EFFORT` to TS and Rust.
- It's an owner choice, not a measurement. The schema keeps it apart from the measured
  values: `effort_levels` and `effort_key` stay `UNKNOWN`, because no effort level or
  CLI launch key has been measured in `docs/field-availability.md` yet.
- So no launch path applies Medium yet. Nothing may pass an effort flag to `claude`
  until `effort_key` has a measured source, and the seat keeps the CLI's own default until
  then. `crossCheck` requires the default to be one of the default model's measured
  levels once they exist, so a later measurement can't silently drop it.

## 2026-09-23 — OWNER DECISION 1: his own ToS read (item 8 gate, first half)

**Muad's words, relayed by C&C (thcmcp-31), not typed into this session:** *"always a
human giving the C&C session instructions ... this is 'ordinary, individual usage' ... I
think this concept is OK to proceed"*. This is his reading of Anthropic's consumer terms.
Nothing in this repo interprets them for him (PLAN.md §10 decision 1), and no session
checked his reading.

- **What it closes:** the "read the terms himself" half of item 8's gate
  (`docs/ITEM-8-CHECKLIST.md` step 1, and the decision in step 2).
- **What it doesn't:** the clearance file `~/.config/zofia/item8-owner-clearance` is still
  his to create by hand (checklist step 2). No session creates it, and no session has run
  the real `claude` for Zofia. `scripts/tool-policy-probe.mjs` refuses the real CLI until
  that file exists, so item 8 stays blocked on that one step of his.
- **The premise it rests on** is his own: a human always gives the C&C seat its
  instructions. That fits the current design. The seat sends only what the owner types,
  and the corners are read-only. Any future feature that sends input into a session
  without a human typing it would fall outside this reading. It would need his go again.

## 2026-09-23 — decision 2 applied: the seat launches with `--effort medium`

C&C (thcmcp-31) checked `claude --help` for 2.1.280 and found `--effort <level>`,
"Effort level for the current session (low, medium, high, xhigh, max)". This session
confirmed the same strings in the installed 2.1.280 binary without running the CLI. That
check is now `docs/field-availability.md#cli-effort-flag`, and `effort_key` is `--effort`
with that source. `seat_argv` ends with `--model sonnet --effort medium`. A cargo test
asserts the argv the mock actually receives. The item 8 probe passes the same flag, so
it tests what ships. This supersedes the "no launch path applies it yet" line in the
decision-2 entry above. That entry is left as written.
**Still UNKNOWN:** which levels each model accepts, and what any level costs.
`effort_levels` stays `UNKNOWN` for every model.


## 2026-09-24 — the full-grid breakpoint follows the pane floor (quality check Q7)

The owner said go on the quality check's medium items ("Let's start with them then"). Q7
showed `BREAKPOINT_FULL = 1280` dropping two corners that fit: at 1024 px both remaining
panes were ~490 px wide. The breakpoint is now derived, `2 × PANE_FLOOR_WIDTH + 3 × gap`
(996 px), so the 2×2 grid shows whenever two corners fit side by side at the floor. The
480×320 floor and the 900 px medium breakpoint are unchanged, and all three stay PLAN.md
§4 placeholders: §10 decision 3 (the owner measuring his screen) still replaces them.

## 2026-09-25 — the repo goes public (owner's call)

The owner, to C&C: *"I also want to make Zofia open source, can you also scan it for secrets and
then change it to public?"* This opens `PLAN.md` §9.2 item 3 (the public release) early; the
year-1 build order is unchanged. Before the flip, C&C scanned all 80 commits on every branch for
API keys, tokens and private-key headers (none), and for tracked `.env`, transcripts, `BOARD*`,
`-cheap` copies or `Review/` files (none; they stay gitignored). One real Claude Code session id is
quoted in the 2026-09-23 item-1 entry; it is not a credential. `LICENSE` (Apache-2.0, the same text
and holder as Sophi-A's) was added, matching `package.json`.

## 2026-09-25 — licence: Apache-2.0 → MIT (owner's call)

The owner, to C&C, the same day the repo went public: *"I want to make sophia and zofia MIT license
too"*, matching The High Council (MIT). `LICENSE` is now the MIT text with the same holder as THCMCP's
(Sower Industries); `package.json`, `package-lock.json` and `src-tauri/Cargo.toml` follow. The copy
published under Apache-2.0 between the two commits stays available under Apache-2.0 to anyone who took
it; that cannot be withdrawn and doesn't need to be. Bundled fonts keep their own licences.

## 2026-09-25 — honest states: blocked, your turn, failed (research brief 04, P2)

C&C dispatch (zofia-3b, "Zofia 0.2.0 ready for strangers"), from `zofia-research`'s brief 04.
**The bug:** an API error (rate limit, overload, auth) ends a turn with `StopFailure`, not `Stop`
(Claude Code hooks docs, fetched 2026-09-25: the two are alternative turn endings). The shim
never registered `StopFailure`, so the last event stayed a working one and the corner read
`processing · 12m`, climbing for as long as the process lived. Found by reading code and docs,
not observed live.

- The installer now registers `StopFailure`, `PermissionRequest` and `PostToolUseFailure` too
  (10 events). The shim keeps `StopFailure`'s `error_type`, a category such as `rate_limit`,
  never the message text. It prints nothing, so it never answers a `PermissionRequest`.
- The old single "waiting for input" splits in two. **blocked** (`◆ blocked: permission` from
  `PermissionRequest` or a `permission_prompt` notification; `◆ blocked: question` from an
  elicitation dialog or `agent_needs_input`) means the session can't go on without a person.
  **your turn** (`●`, from `idle_prompt`) means the turn is over and the prompt has sat idle.
  **failed** (`! failed: rate_limit`) ends the turn like `Stop`. None of the three ever ages
  into "stale". A failed tool call stays a working state, because the next step often recovers.
- `Stop` still reads `idle`. The brief's "your turn after every Stop, fading once seen" needs a
  per-corner "seen" flag; that's left for the needs-you queue work, not guessed at here.
- **Turn line:** the shim also stamps `turn_ended_at` at `Stop`/`StopFailure`. Before this, a
  later `idle_prompt` replaced the `Stop` and a finished turn read "working for 33m" again. A
  failed turn reads "failed after 2m 3s".
- Both readers changed together. Six new cases in `test/reader-parity/`; colours clear AA on
  `--surface-raised` (your turn `#8ab4d9` 8.6:1, failed `#ff6f61` 6.9:1, blocked unchanged).
- **An existing install doesn't get the new events until the installer runs again.** It is
  idempotent and adds only the missing events. Re-running it on the owner's real
  `~/.claude/settings.json` is his call, as before.
- **Still unverified live:** when `idle_prompt` fires (the hooks page doesn't say), and that
  `Stop` never follows `StopFailure` (the docs' lifecycle reading, not an observation).

## 2026-09-25 — the installer knows its wrapper by shape, not by a "zofia" path

Research brief 03 found `isZofiaWrapper()` only matched a statusLine command whose path held
"zofia". A checkout under any other name (a fork, a worktree, `/tmp/x`) didn't recognise its
own wrapper on a re-install and wrapped it a second time; `install.test.mjs`'s backup test
failed there. Reproduced in a worktree at `/tmp/chk-3b`: 6/7 before, 7/7 after. The check is
now the exact shape `statuslineWrapperCommand` writes (optional
`ZOFIA_ORIGINAL_STATUSLINE_CMD='…'` prefix, then `bash <dir>/statusline-wrapper.sh`), so a
wrapper from a different checkout path is recognised too and left as-is.
**Not changed:** a re-install from a second checkout path still adds that path's hook commands
next to the first path's, as before; uninstall removes each by its recorded command.
