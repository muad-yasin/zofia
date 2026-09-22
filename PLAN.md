# PLAN.md — Zofia: dev-build plan, Linux build plan, architecture and philosophy

*Zofia is the successor to Sophi-A: a Linux AppImage GUI giving a command-and-control overview of
several Claude Code terminal sessions, run on the owner's own Claude Code subscription. The owner's
handwritten spec is binding. Structure per QWEN38MAX-1's accepted spine.*

## 0. What this plan assumes and does not assume

The owner opens four Claude Code terminal sessions by hand; Zofia does not have to spawn them. A
fifth, central seat is owned by the GUI, because the owner needs to type into it directly. The screen
is a fixed top menu bar, four corner panes, one center pane. Nothing here claims the multi-lab debate
mechanism improves plan quality: the fact pack records one inconclusive pilot result and no more, and
no stronger claim is made anywhere in this document.

## 1. Sophi-A disposition ledger — Q1 answered here

**Accepted (canonical):** GLM53-2, "Sophi-A disposition ledger" — a fixed, complete 19-row checklist
(enumerated from the fact pack's current-state section, then counted — the row count is derived, not
asserted first, after GPT6ASTRA's objection caught two missing rows in an earlier draft). Every
element the fact pack names carries exactly one label from {kept-unchanged, adapted, replaced,
new-for-Zofia, dropped}.

| # | Sophi-A element | Label | Reason |
|---|---|---|---|
| 1 | Tauri v2 shell + vanilla-TypeScript frontend | kept-unchanged | No framework migration — a real Svelte proposal was caught and rejected in debate for exactly this reason. |
| 2 | `claudeCodeSubprocess.js` | kept-unchanged | The base spawn pattern; see row 19 for its PTY adaptation. |
| 3 | `messagesApi.js` | kept-unchanged | Not used by any v1 seat, but not deleted. |
| 4 | `relayChainSubprocess.js` + THCMCP/relay integration | kept-unchanged | Off by default; the mechanism §9's later optional layer would reuse. |
| 5 | WS auth token + allowed-origins gate | kept-unchanged | Reused for the center seat's IPC. |
| 6 | `CLAUDE.md`/`.claude`/`.mcp.json` hash sweep + trust-level tags | adapted | Scoped to the GUI-owned center seat's own workspace — it can vouch for nothing inside the owner's foreign corner terminals. |
| 7 | MCP introspection server | kept-unchanged | Not needed until there's more than the center seat to introspect, but not removed. |
| 8 | Cost transparency (dry-run, CSV export) | adapted | To per-session display; the dry-run mechanism itself is kept for §9's later layer. |
| 9 | Seat-owned families | kept-unchanged | Off by default; §9 answers whether it's reused later. |
| 10 | AppImage CI packaging | kept-unchanged | Promoted to the primary v1 artifact (§7). |
| 11 | Windows NSIS packaging | **dropped (v1)** | Owner's spec names Linux first. The inherited CI job is retained in-repo, not deleted — a future Windows build is a re-enable, not a rebuild (§10 decision list). |
| 12 | Apache-2.0 license | kept-unchanged | Distinct row from distribution mode (13) — a real gap an earlier draft conflated, caught and split. |
| 13 | Source-only distribution mode | adapted | Source distribution continues; the binding spec adds a built AppImage artifact on top — still nothing resold. |
| 14 | Hand-synced `cnc`/advisor provider list | **replaced** | By the generated single-source config (§5.1). |
| 15 | 8-seat fixed layout | **replaced** | By the owner's binding 5-seat, 4-corners-plus-center layout. |
| 16 | BYOK / nothing-resold | kept-unchanged | The operating principle throughout. |
| 17 | Markdown/report export + read-only run-history replay | kept-unchanged | Extended to corner-session snapshots in a later slice, not v1. |
| 18 | Platform targets + mobile-exclusion reasoning | adapted | v1 targets Linux only; the mobile reasoning is re-argued for a read-only companion under Q2 (§1.1). |
| 19 | Center-seat PTY adapter | adapted | From `claudeCodeSubprocess.js` — still spawning `claude`, now interactive (§4). |

**Confidence (Q1): HIGH.** Every kept/adapted/replaced row cites a fact-pack element directly; every
dropped row names what's retained versus removed. **Commitment: yes**, this ledger is v1 scope, not
analysis.

### 1.1 Q2 answered: does Sophi-A's mobile exclusion still hold?

Sophi-A's Android/iOS exclusion rests on one fact: the app spawns and owns real local subprocesses,
which mobile sandboxes forbid outright. Zofia's two halves answer differently:

- **The corner-session observation bridge (§2) is read-only and spawns nothing** — it only reads
  local state files a statusline wrapper and hooks write. A process that only reads a file does not
  hit the subprocess-sandboxing wall. **Weakens** for this half: the real blocker for a future mobile
  companion is that the bridge's state lives on the Linux machine and nothing here syncs it anywhere
  (§6 is zero-egress by design) — a phone couldn't read it without a sync mechanism this plan does not
  build, which would need its own privacy review first.
- **The center seat (§4) owns a real PTY running `claude`** — exactly Sophi-A's spawning pattern,
  unchanged. **Holds completely** for this half.

**Confidence (Q2): MEDIUM-HIGH** that the architecture opens a real path toward a future read-only
mobile companion; **LOW**, deliberately, on whether it's worth building. **Commitment: analysis-only**
— nothing in this plan's v1 scope depends on this answer.

## 2. Session-state reader (observation bridge) — Q5 and Q12 answered here

**Accepted (canonical):** GPT6ASTRA-1, "Provenance-bearing session observation bridge," merged with
FABLE51-1's concrete shim mechanics per the debate's own consensus (five labs independently proposed
converging designs; GPT6ASTRA-1 and FABLE51-1 explicitly merged into one). **Sophi-A: new** — nothing
in Sophi-A reads state from a process it doesn't own.

### 2.1 The mechanism

- **Install:** a reversible, diff-confirmed installer writes Zofia's shim into
  `~/.claude/settings.json` as the `statusLine` command and as `Stop`/`PreToolUse`/`PostToolUse`/
  `Notification` hooks. If a `statusLine` command already exists, the shim **wraps it** — invokes the
  original and passes its stdout through unchanged — and records the original plus a hash of the
  written block. **Uninstall restores only if that hash still matches** what's currently installed;
  otherwise it refuses and shows the diff, so a hand-edited settings file is never silently clobbered.
- **Transport:** per-session state files under `$XDG_RUNTIME_DIR/zofia/sessions/<session_id>.json`,
  directory `0700`, files `0600`, on tmpfs — nothing persists across reboot, nothing needs hardening
  against a listening socket because there is no socket. A Rust `inotify` watcher (250ms debounce,
  placeholder) feeds the existing authenticated frontend transport.
- **Registration is explicit, never automatic discovery:** the owner assigns a detected `session_id`
  to each corner pane by hand. The bridge never scans `~/.claude/projects/` and auto-fills panes from
  whatever it finds — Fixed Premise 3 (privacy) requires minimal read, not maximal convenience.
- **Provenance on every field:** `{value, availability: exposed|approximable|unknown, source, 
  observed_at}` — the frontend renders these attributes, never a bare value, so a reader can always
  tell a measured fact from a guess.
- **A real semantic bug caught and fixed in debate:** an earlier draft labeled a session "idle" after
  120 seconds without any event. That's wrong — silence doesn't mean idle, it could mean a
  long-running tool or a disconnected watcher. Fixed: render `stale (last event Ns ago)` or `unknown`
  by default; reserve `idle` for a verified lifecycle event (`Stop`/`Notification`); test terminal
  death as its own disconnection case, never inferred from an idle timer.
- **Transcript JSONL tailing is opt-in per session, off by default** — a real bug caught and fixed:
  an earlier draft made it a default third source, which reads a session's full content unasked;
  three independent labs objected on the same privacy-premise grounds. Fixed: default path is
  statusline wrapper + hooks only; the week-1 measurement (§8) decides whether any single field is
  worth the toggle.

### 2.2 Session-state field availability matrix (Q5 answer)

**Accepted (canonical):** GLM53-1, merged with DEEPSEEKV4PRO-1's table definition. Nine owner-named
fields × four candidate sources; every cell holds `exposed`, `approximable`, or `unknown`, plus a
confidence tag.

| Field | statusline JSON | hooks | transcript JSONL (opt-in) | embedded PTY | Confidence |
|---|---|---|---|---|---|
| Model | exposed | — | — | — | HIGH |
| Effort | unknown | — | — | — | UNKNOWN, pending week-1 measurement |
| Usage % | unknown | — | — | — | UNKNOWN, pending week-1 measurement |
| 5-hour reset timer | unknown | — | — | — | UNKNOWN — **never inferred locally from usage timestamps without a verified source**, even after the probe, unless that source is real |
| Context % | approximable | — | approximable (fallback) | — | LOW on the fallback — a token-arithmetic proxy (`input + cache-read tokens vs. context window`) is explicitly an **unvalidated proxy that likely undercounts**, never presented as measured occupancy |
| Activity state | approximable | exposed | approximable | — | MEDIUM via hooks; the transcript fallback is a second-choice source only |
| "XYZ for 49s · done XX:YY" line | unknown | — | **disputed** | exposed (center seat only) | Two labs disagreed on whether transcript duration fields carry this; the cell records the dispute and names week-1 measurement as adjudicator, not a guess either way |
| Token spend (USD) | exposed (cost field, when present) | — | — | — | HIGH, when present |
| Token spend (token counts) | — | — | approximable, opt-in | — | LOW — **kept strictly distinct from USD cost, never conflated** |
| Last-active time | — | exposed (last observed event) | — | — | HIGH — derived from the last observed hook/statusline event, never from file mtime (a real bug: mtime measures a file write, not session activity — caught and fixed) |

**Confidence (Q5): HIGH** on the mechanism and the discipline (measure, don't guess); **LOW,
deliberately**, on every field's actual value until the week-1 probe (§8) reports real numbers — the
whole point of this table is that guessing here is the single most costly mistake this plan could
make. **Commitment: yes**, the mechanism and matrix are v1 scope; the field *values* are not
committed, only measured.

### 2.3 Privacy architecture constraints (Q12 answer)

**Accepted (canonical):** DEEPSEEKV4PRO-2, "Privacy architecture constraints," amended after a real
test-design bug was caught: an earlier draft's acceptance test captured all traffic in a network
namespace for 10 minutes and asserted zero non-loopback packets — but the center seat's own `claude`
child legitimately talks to its provider, so a host-wide capture would either fail or have to quietly
exclude that child, and a test that excludes things ad hoc isn't a test. **Fixed to per-process
attribution.**

- The GUI shell binary itself never initiates an outbound connection except to the local orchestrator
  (loopback only).
- **Automatic telemetry the bridge (§2.1) reads on its own never leaves the machine** — this rule is
  scoped precisely to the bridge's own unattended reads, not to every byte the product ever handles.
  It does not, and is not meant to, describe the separate case where the owner *deliberately* forwards
  selected corner text into the center seat's prompt (§3's confirmation-before-forwarding rule) — that
  is an explicit, owner-initiated action governed by its own rule, not a silent leak this constraint
  would be contradicted by. The two are named separately on purpose so neither reads as covering the
  other.
- The bridge caches only last-known state in memory; no disk cache of transcript content, ever.
- The embedded center seat's own `claude` child makes its own authorized provider connection
  independently — the same connection an owner-run Claude Code session already makes, not new egress
  Zofia introduces. This is the one documented, permitted non-loopback connection anywhere in the
  system. Any text the owner explicitly forwarded into it (per §3) travels only as part of that same
  already-authorized connection, not as a separate egress path.
- Any future local-LLM integration (§10) uses the same local-only path this section already
  describes.

**Acceptance test:** an isolated network namespace, mock corner activity, a `connect`-syscall trace
scoped to the GUI shell process's own PID tree (every process the shell itself spawns, not a
host-wide capture, and not merely its single top-level PID, so a helper process can't slip outside
the boundary) — zero non-loopback calls from that PID tree over 10 minutes. With a real center-seat
child running, a separate, attributed check confirms its provider traffic is the *only* non-loopback
traffic anywhere, correctly attributed to the child's own PID within that same tree, never miscounted
as shell egress and never excluded from monitoring either.

**Confidence (Q12): HIGH** on the enforcement mechanism; the main open risk is whether the AppImage's
own sandboxing (§7) interacts correctly with PID-scoped attribution, which this plan does not claim
to have verified yet. **Commitment: yes.**

## 3. Center seat (C&C) — Q3 and Q6 answered here

**Accepted (canonical):** GPT6ASTRA-2, "Ownership-aware embedded C&C terminal," merged with
FABLE51-2's concrete launch mechanics. **Sophi-A: adapted** from `claudeCodeSubprocess.js`.

- A real Claude Code session under a `portable-pty`-owned PTY, rendered via `xterm.js`. The owner
  types directly into it.
- **Ownership is a capability boundary, checked on every Tauri/WebSocket/MCP control path**: only the
  owned center PTY may receive input, resize, or a termination signal. Corner sessions are exposed
  for observation and detach only — never input, restart, or process termination, on any code path,
  with no exception.
- **A real "prove it, don't assert it" bug caught in debate:** an earlier draft called a
  `cnc-settings.json` denying `Bash`/`Write` "deny-by-default hardening." A critic correctly objected:
  naming two denied tools is not a policy, and Claude Code merges user, project, and settings-file
  permissions, so `Edit`, `MultiEdit`, MCP tools, or a project's own `.claude/settings.json` could
  grant equivalent authority the plan never accounted for. **Fixed:** the tool policy is an
  allow-list (only `Read`/`Grep`/`Glob`, plus `WebSearch`/`WebFetch` if the owner opts in — everything
  else denied including all MCP tools unless the owner names a server); a week-1 spike on the
  owner's actual installed CLI version scripts a probe that *attempts* each denied tool and records
  whether it's actually refused, producing `docs/cnc-tool-policy.md` with a CLI-version stamp — the
  policy's effectiveness is measured, not assumed from the file.
- **Foreign project settings are not silently inherited:** launching in a directory containing its own
  `.claude/settings.json` or `.mcp.json` shows the owner that file's permission/MCP entries and
  requires confirmation before launch, since merged project settings can widen the policy beyond what
  the plan intends.
- Sophi-A's hardening carries over unchanged for this one seat: WS token + allowed-origins gate, hash
  sweep, trust-level tags. Scrollback is memory-only, never written to disk.
- **Model selection is the owner's, never an algorithmic claim.** An earlier draft's `How` implied the
  plan should pick "the most capable" model automatically; a critic correctly objected that the fact
  pack defines no objective model-strength ordering. Fixed: the owner picks the C&C model from the
  shared config (§5.1); the plan states this as an owner decision (§10), never a security or quality
  claim.
- **Confirmation-before-forwarding:** any corner-pane text the owner explicitly selects and forwards
  into the center seat's prompt requires an explicit confirmation step; unselected corner content is
  never forwarded or persisted. This is stricter than "the bridge and the center seat don't share
  state" (true by construction, §2 and §4 don't cross-reference each other's data) — it's about what
  happens if the owner deliberately pastes corner text into the C&C chat.

**Acceptance test:** against a deterministic fake `claude` and one independently running observed
process — typed input reaches the fake byte-for-byte; the same input aimed at the observed
`session_id` is rejected in the Rust core. Against the real installed CLI under `cnc-settings.json`, a
scripted probe attempts each denied tool and each attempt is refused. Launching in a fixture directory
with a permissive project settings file shows the confirmation dialog and doesn't launch until
confirmed. Closing the GUI leaves the observed corner process alive. `grep -r` across Zofia's config/
cache/log directories finds no scrollback text. The displayed C&C model equals the owner's actual
selection.

**Q6, the rejected alternative, stated explicitly (a real gap an earlier draft left implicit, then
sharpened after a real precision catch in review):** the other option Q6 names is a *view onto an
external terminal the owner runs himself*. This splits into two genuinely different cases, and an
earlier version of this section wrongly treated them as one:

- **A truly independent terminal, with no cooperative arrangement** (the owner just opens `claude` in
  a plain terminal emulator): there is no *attach*-based input path — the GUI cannot become the PTY's
  controlling process without exactly the kind of foreign-PTY attach §4 already establishes is
  impossible for a process the GUI didn't spawn. **This is not literally the only mechanism that
  exists, and an earlier version of this section overstated it as one** — a real, precise correction
  from review: X11 input injection (e.g. `xdotool`-style synthetic keystroke events aimed at another
  window) is a genuinely existing Linux mechanism that could, in principle, deliver input to a terminal
  the GUI never spawned. This plan deliberately rejects it, not because it's impossible, but because
  it's the wrong tool: it can't reliably target only the intended window (a real security hazard — a
  misdirected synthetic keystroke goes wherever focus happens to be), it doesn't work at all under
  Wayland (the compositor blocks exactly this by design, and Wayland is where Linux desktops are
  headed), and even where it works it can't distinguish "the owner is also typing" from "Zofia is
  injecting," which corrupts the very observe-only boundary §4 exists to protect. So: a mechanism
  exists: rejected on stated security and reliability grounds, not absent from the universe of
  possible approaches.
- **A deliberately shared session** (the owner sets up `tmux` and explicitly grants Zofia a client
  attachment to that session): `tmux`'s own client protocol *is* a real, cooperative interface input
  could flow through — a second real mechanism, and one this plan also doesn't build, for a different
  reason than X11 injection: it's a fundamentally different integration (Zofia would have to become a
  `tmux` client, with its own auth/attach story, its own failure modes if the owner detaches, and its
  own privacy surface needing a new documented exception in §2.3), not something rejected on safety
  grounds.

That is the real engineering-complexity comparison Q6 asks for: the owned PTY costs one seat's worth
of spawn-and-hardening work (§3 above) and nothing else; X11 injection is a real but deliberately
rejected mechanism (security and reliability, not impossibility); the cooperative-`tmux` case is also
possible but costs an entirely separate client-integration surface this plan doesn't need, since the
owned PTY already satisfies what the owner asked for at a fraction of either alternative's cost.

**Confidence (Q6): HIGH** that a GUI-owned PTY is the right mechanism, and that neither real
alternative (X11 injection, a cooperative `tmux` attach) is worth building for what the owner actually
asked for — not because either is impossible, but because the owned PTY delivers the same outcome
(typed keystrokes reaching a real session) without screen-scraping, without reimplementing Claude
Code's UI, and without either alternative's own separate cost (a rejected security/reliability
trade-off for X11, a whole additional client-integration surface for `tmux`).
**Confidence (Q3): MEDIUM** — reusing the shipped hardening plus the allow-list policy is clearly
right in direction; "which model, concretely" is an owner decision (§10), not something this plan
settles. **Commitment: yes** for the mechanism; model choice itself is **analysis/owner-decision**.

## 4. Shell layout — Q8 answered here

**Accepted (canonical):** MUSESPARK12-2, "Responsive 4-Corners-Plus-Center Shell Layout" — vanilla
TypeScript, absorbing GEMINI38FLASH-2's geometry after a real bug was caught and fixed: two competing
proposals for this layout (MUSESPARK12-2 and GEMINI38FLASH-2) each introduced a Svelte component
(`.svelte` files) into a shell the fact pack documents as vanilla TypeScript — three independent
critics caught this as exactly the kind of silent framework migration Fixed Premise 1 forbids. Fixed:
both authors' own amends drop Svelte; the layout ships as `src/lib/layout/GridShell.ts` +
`paneRegistry.ts`, modifying `src/main.ts`.

- Fixed top nav bar, 64px (touch-target + title space). Four corner panes, center pane
  position-absolute, capped at ≤40% viewport width/height (a **ceiling**, not a target, making the
  owner's own "never reaching too much into the visual portion" line testable), draggable/minimizable.
- **Pane floor (placeholder, C&C edit 2026-09-22):** a corner pane never renders below **480×320 px**;
  under that the slot shows a compact one-line state card (model + availability chip) instead of the
  full card. This value is a placeholder, like the breakpoints above, and §10 decision 3 replaces both
  with measurements from the owner's real screen. Added because §10 already promised §4 would state a
  pane-floor value and §4 did not.
- **Viewport breakpoints** (screen size, independent of session count): ≥1280px shows the full 2×2
  corner grid; 900-1279px collapses to 1×2 plus a tab strip; below 900px, a single tabbed pane.
- **Session-count scaling** (a distinct axis from viewport size, real content a prior draft left
  unanswered): the owner's sketch shows four corners, but registration (§2.1) is per-session, and the
  layout must handle counts other than exactly four. **Fewer than four registered sessions:** the
  layout still renders four corner slots; unregistered ones show an explicit "no session assigned"
  placeholder — never a re-flow that hides them, so the owner always sees the same fixed frame he
  sketched. **More than four:** the fifth and later registered sessions go into the same keyboard-
  accessible tab strip the small-viewport breakpoint already uses, rather than shrinking four panes to
  fit five — reusing one mechanism for two different pressures (screen size, session count) instead of
  building two. The literal "4" is the v1 default shape at every count and every viewport; both axes
  above are graceful degradation from it, never the default presentation.
- **Corner panes render the observation bridge's `SessionSnapshot` data (model, effort, usage%,
  context%, activity, token spend, last-observed) — they are state cards, not a PTY view.** A real
  and repeated bug in debate: at least three separate proposals described corner panes as
  "EmbeddedXterm (read-only PTY view)." Every one of them was caught by multiple independent critics
  making the same point: **a GUI process cannot attach a read-only PTY to a terminal the owner opened
  himself in a separate process without `ptrace`-level tricks the fact pack never authorizes.** This
  is not a design choice this plan declined — it's a real, confirmed architectural impossibility for
  hand-opened terminals on Linux. Corner panes render state, never terminal bytes, and no future
  slice may reintroduce this idea without first explaining how the impossibility above stopped
  applying.
- Keyboard: roving `tabindex` across all five panes plus the top bar (`Tab`/`Shift-Tab`); keyboard
  minimize/restore. Screen reader: throttled `aria-live` (max 1 announcement per 2s) for state
  changes — not every update, which would make the screen unusable.
- **Contrast and zoom** (a real gap an earlier draft left out entirely, despite Q8 naming both
  explicitly): all pane text and state indicators meet WCAG 2.2 AA contrast ratios (4.5:1 normal text,
  3:1 large text/UI components) against both the default theme and Sophi-A's existing palette. All
  sizing is `rem`-based, never fixed pixels, so browser/OS zoom up to 200% reflows the grid rather than
  clipping or overlapping panes — the same breakpoint logic already handling small viewports (above)
  is reused for zoomed-large-effective-viewport cases, rather than building a second responsive system.

**Acceptance test:** headless Chrome at 1280×800, 1024×768, 800×600 — at 1280px, four corner state
cards plus a center ≤40% width; at 800×600, a single pane with a tab switcher; all five panes reachable
via `Tab` in documented order; corner panes render whitelisted state text, never terminal bytes; an
automated contrast check (e.g. `axe-core`) reports zero violations at default and 200%-zoom renders; the
center pane is a focusable owned PTY accepting typed input; the build contains zero `.svelte` imports.

**Confidence (Q8): HIGH** that the literal 4-corners-plus-center default matches the owner's sketch;
**MEDIUM** on the specific breakpoint pixel values, which are placeholders pending the owner measuring
his actual screen (§10). **Commitment: yes.**

## 5. Provider/model config — Q11 answered here

**Accepted (canonical):** FABLE51-3, "Single-source provider/model/effort schema," resolving an
orphaned two-proposal cycle (FABLE51-3 and MUSESPARK12-3, which withdrew citing each other). FABLE51-3
is adopted as the landing point since it's the version every other lab's merge post explicitly points
at, carrying forward MUSESPARK12-3's schema-level rejection mechanism and GPT6ASTRA's important
correction.

- One `config/providers.json`, validated by a JSON schema, is the only authority for providers,
  models, and a new `effort` axis. A build step generates `src/generated/providers.ts` and
  `src-tauri/src/generated/providers.rs` (gitignored, rebuilt on `npm run build`); CI fails if the
  generated files are stale relative to the source — this is the fix for the hand-synced
  `ALLOWED_PROVIDERS` drift Sophi-A's own build log names.
- `xai` and any model id matching `grok` are rejected by the schema's own `not` clause, so the build
  fails before a dropdown could ever list one. **A real defense-in-depth bug caught and fixed:** an
  earlier draft treated the schema rejection as the whole enforcement ("the code-enforced standing
  rule moved upstream"). A critic correctly objected — the schema only stops what's declared in
  `providers.json` at build time; it does nothing against a model arriving at runtime via an alias,
  OpenRouter routing, or a user-typed id. **Fixed: Sophi-A's existing runtime backend rejection stays
  in front of every invocation, unchanged; the schema is an additional build-time gate, not a
  replacement for it.**
- **Effort is capability-driven, never a fixed vocabulary.** An earlier draft mapped `effort:
  low|medium|high` directly to `thinking.budget_tokens: 1024/4096/8192` — three independent critics
  objected that this is an invented, unverified mapping for the owner's actual subscription/CLI
  behavior. Fixed: each model declares its own `effort_levels` (a subset of a provider-defined
  vocabulary, not a universal three-tier constant); for CLI-spawned seats the effort key is written
  into the launch settings file and marked "verify against current CLI docs" in the schema itself,
  never guessed; for the `messagesApi.js` chat path it maps to the provider's real API parameter.
  Concrete values are decided in week 1 (§8), not asserted here.

**Acceptance test:** adding a grok/`xai` entry to `providers.json` makes `npm run build` exit
non-zero on the schema check; with it removed, generated TS and Rust list byte-identical ids (CI
diff); `grep -r ALLOWED_PROVIDERS src/` returns zero hand-maintained hits; editing `providers.json`
without regenerating fails the stale-files lint; the runtime backend rejection of `xai`/`grok` (kept
from Sophi-A) still fires independently of the schema, verified by a test that bypasses the schema
entirely and calls the backend directly.

**Confidence (Q11): HIGH** on the single-schema mechanism and the defense-in-depth reasoning; **LOW,
deliberately**, on what effort tiers actually exist until the week-1 probe reports back. **Commitment:
yes** for the mechanism; the concrete effort values are **analysis pending measurement**.

## 6. Linux packaging — Q9 answered here

**Accepted (canonical):** GPT6ASTRA-3, "Reproducible Linux AppImage release gate" — stands, unopposed
in debate. **Sophi-A: adapted** (kept CI path, extended with new smoke tests).

- Extends Sophi-A's existing AppImage CI path rather than adding a competing pipeline. Tauri is
  retained *provisionally* — the existing repository integration is the stated reason, not treated as
  proof of Linux compatibility on its own.
- Pin frontend/Rust dependencies, AppImage tooling, and the build-container image digest. **A real
  discipline correction the debate insisted on:** don't claim "universal Linux support" — select the
  oldest supported baseline after an early packaged spike, and record the exact supported
  distributions, architectures, WebKitGTK requirements, and build-image digest in
  `packaging/linux-support.md`.
- **Test the actual packaged artifact, not just a dev-server run:** on every declared supported
  distribution, both with FUSE available and through the documented `--appimage-extract-and-run`
  path without it. The smoke test must open the GUI, render the corner-and-center shell, stream
  synthetic observation events, and drive a fake center PTY — a bare process-start check does not
  qualify.
- Missing Claude Code itself produces an actionable local-setup screen while observation fixtures
  stay usable — the artifact never silently installs Claude Code or bundles credentials.
- Checksums, a dependency inventory, license notices, and detached release signatures, with the
  signing key kept outside the application and repository. **Updates are owner-initiated replacement
  downloads only** — signature-verification instructions, the previous artifact retained for
  rollback, no background update requests, no telemetry. This is a privacy choice (§2.3), not a
  missing feature: an update-check call would itself be the unsolicited egress that section forbids.
- **Stated plainly, not implied:** AppImage is a packaging format, not a sandbox. Same-user Claude
  processes and local administrators sit outside whatever the token gates and private files protect.
  No remote read-state endpoint exists anywhere in the design.
- **If a declared target can't reliably run the packaged renderer and PTY, the supported baseline (or
  the Tauri choice itself) is reopened before more GUI features are added** — this order of
  harm-avoidance is explicit in the plan, not left to judgment mid-build.

**Acceptance test:** on each clean supported Linux image, launch the release artifact with application
networking blocked, repeat through extract-and-run with FUSE unavailable, and exercise synthetic
session updates plus fake C&C input. Both launch paths show the working GUI and terminal; the
signature verifies before launch; no application-originated network request is observed.

**Confidence (Q9): HIGH** that Tauri/AppImage is the right v1 baseline — nothing in this run's debate
argued for replacing it, and it's the toolkit §2-§4 are already built against. **LOW** on the exact
supported-distribution list and artifact-size budget until the early spike (§8) measures them.
**Commitment: yes.**

## 7. Terms of service — Q7 answered here, explicitly unresolved

**This plan does not resolve this question.** Whether observing or driving Claude Code sessions from
a third-party GUI, on a consumer subscription, fits Anthropic's terms of service is not something the
fact pack settles, and no claim is made either way. The owner must read Anthropic's current consumer
terms directly, specifically for: (a) automating or wrapping the CLI from a third-party application,
and (b) reading a session's own output/state files rather than only interacting through the CLI
itself. **This gate blocks real-subscription center-seat testing** (§8, week 2) — the week-2 mock
exercise proceeds regardless, but testing against the owner's actual subscription waits for his own
verification.

**What "other providers' token subscriptions" and "local LLMs for everything" would mean, technically,
for the later open-source release** (analysis, per §9's discipline — not a v1 commitment): this needs
two separate answers, one per side of Zofia's own boundary — an earlier draft conflated them, which a
review correctly caught. **For the corner sessions the owner opens by hand, choice of CLI/provider is
his, made independent of Zofia — but Zofia's own bridge (§2.1) is not automatically provider-agnostic,
a real limitation an earlier draft overstated.** The bridge specifically installs itself as a Claude
Code `statusLine` command and Claude Code's own named hooks (`PreToolUse`/`PostToolUse`/`Stop`/
`Notification`) — a mechanism this plan documents from the Claude Code fact pack specifically, not a
generic "any CLI" interface. A different vendor's tool would need its own equivalent hook/statusline
surface, and nothing here establishes that one exists or looks the same; observing a non-Claude corner
session would require a **per-vendor adapter this plan does not design**, not automatic compatibility.
The honest scope: whatever the owner runs in a corner terminal is always his choice, but Zofia
*observing* that session's state, for any provider besides Claude Code, is unbuilt and unscoped —
named here as a real open question for whoever revisits this later, not answered as already solved.
**For the one seat Zofia itself owns and spawns — the center seat (§4) — this is where the extension
is actually Zofia's to design, and is provider-agnostic by construction:** "other providers'
subscriptions" means the center seat's PTY spawns a different CLI/binary under the same ownership and
hardening §4 already specifies, with §5's schema already generalizing the provider/model config for
exactly this; "local LLMs" means the center seat's one documented provider exception (§2.3) becomes
unnecessary for that seat, since a local model process never needs to leave the machine at all — a
*stricter* privacy posture than the cloud-subscription case. Each extension raises its own
terms-of-service question, independent of Anthropic's, which this plan does not resolve either.

**Confidence (Q7): none claimed, deliberately** — named as unresolved, not answered with low
confidence. **Commitment: no** — this is the first item on the owner-decision list (§10).

## 8. First two weeks, and what would change the plan

**Accepted (canonical):** GLM53-3, "First-two-weeks slice: reader spike plus five-pane shell, with
falsification triggers," merged with DEEPSEEKV4PRO-3 and GEMINI38FLASH-3 per the debate's own
convergence — all three named essentially the same slice.

**Week 1, two parallel tracks.**
- **Track A (the reader spike):** a `zofia-reader` CLI emits one JSON snapshot of all nine fields
  (value-or-null, each with a source tag) for exactly one manually-opened session, fed by the
  installed statusline wrapper + lifecycle hooks only — the opt-in transcript experiment is a
  separate, owner-consented run whose sole job is deciding whether any single field is worth the
  toggle, never the default path. Writes `docs/field-availability.md`, converting every §2.2 `unknown`
  cell into a measured yes/no.
- **Track B (the static shell):** the five-pane Tauri shell (top bar, four corner panes, center pane)
  on the existing vanilla-TypeScript frontend, rendering sample data — no reader wiring yet.

**Week 2.**
- Reader snapshots wired into corner panes (250ms debounce, placeholder pending Track A's real
  measurement).
- Center pane backed by `portable-pty`, exposed as an authenticated `spawn-center-seat` command in
  the Rust core, rendered via `xterm.js`, exercised against a **mock** `claude` (real-subscription
  testing waits on §7's ToS gate). The mock exercise must demonstrate real interactive parity — typed
  input reaching the session, prompt rendering, and an interruption key (`Esc`/`Ctrl+C`) actually
  delivered — not output streaming alone.
- First AppImage build, launched on a clean VM through both the FUSE path and the documented
  extract-and-run fallback.
- A zero-egress audit (§2.3's PID-scoped test) run for real against the assembled shell.

**Falsification triggers, each with a named, honest fallback — not an aspiration:**
1. **If the statusline JSON lacks usage % or the 5-hour reset timer:** the field renders `unknown`,
   permanently for that source. A transcript-derived value is admissible only as an explicit opt-in,
   low-confidence proxy for token-count estimates — **never for the 5-hour reset window**, which
   requires a real verified source or stays cut from the product entirely.
2. **If `xterm.js` + PTY can't render the `claude` TUI acceptably:** a wrapped-subprocess streaming
   fallback is adopted *only if it demonstrates the same interactive parity* (typed input, prompts,
   interruption) against the mock in week 2 — no fallback is ever called equivalent without that
   demonstration.
3. **If hooks prove too coarse for activity state:** either accept the coarser state vocabulary as v1
   scope, or offer GUI-spawned corner sessions as an explicit, named, per-corner owner opt-in — which
   Fixed Premise 2 permits as a deliberate, disclosed change to the observe-only model, never a silent
   one. **Read-only PTY attach to a foreign hand-opened terminal is not an available pivot under any
   trigger** — §4 already establishes this is architecturally impossible, not merely undesirable.
4. **If the packaged artifact fails on the declared baseline distro (§6):** the baseline, or the
   Tauri toolkit choice itself, is revised before any more GUI features are built.

**Acceptance test:** a tester on a Linux box with Claude Code installed follows the week-1 blocks
verbatim — the reader command against one real session prints valid JSON with all nine keys, each
carrying a source tag; the default run opens no transcript file; the static shell opens with all five
panes. Week-2: the packaged artifact launches via both paths on a clean VM; the center pane accepts
typed input and delivers an interruption key to the mock session; quitting the GUI leaves the
independently opened corner session alive; a 60-second PID-scoped capture with mock activity shows
zero non-loopback packets attributable to the GUI binary. If any documented command fails as written,
the slice fails — this is a real gate, not a status update.

**Confidence: HIGH** that this is buildable and falsifiable as specified; the whole point of naming
four concrete triggers is to convert "we hope this works" into "here's exactly what we'll know in two
weeks." **Commitment: yes**, this is the literal first two weeks of work.

## 9. The optional free MLLM/MLLLM layer for other users — Q10 answered here

**This plan makes no design decision for this layer and builds no part of it — explicitly out of
scope for the first dev build**, a later, opt-in addition, same as Sophi-A today, and nothing in this
plan's scope, roadmap, or build order depends on the answer below. Sophi-A's seat-owned-family
architecture is already built, tested, and generalizes to "any seat" rather than being hard-coded to
Sophi-A's own eight. **Answering Q10 directly, since a review correctly pointed out that stating the
fact alone dodges the question actually asked:** if this layer is ever built, reusing that existing
architecture directly is the reading a careful professional would choose over building a parallel
mechanism — it already does the job, a second implementation would duplicate real tested code for no
identified benefit, and nothing about Zofia's corner-plus-center shape conflicts with it (a family is
owned by a seat, and a Zofia seat qualifies exactly the way a Sophi-A seat does). **This is a
recommendation for a future decision, not a v1 commitment** — it changes nothing about what gets built
now, and whoever revisits this after v1 ships is free to reconsider it if something changes between
now and then.

**Confidence (Q10): HIGH** on both the fact and the recommendation above. **Commitment: analysis-only**
— a recommendation for a later decision is still not a decision made now.

### 9.1 Q4 answered: where does the advisor concept fit?

The owner's binding spec names exactly five seats — four corners, one center — no "advisor" seat.
Per §1's disposition ledger, `messagesApi.js` is `kept-unchanged` but unused by any v1 seat — not
deleted, since the earlier, looser relay of the owner's goals did mention an advisor concept, and the
binding spec's silence on it doesn't settle whether he'd still want one. **This plan does not design
an advisor seat.** If the owner ever wants this, a mode of the center seat (asking it directly to
"advise on how to continue") is the cheapest path to weigh against a dedicated seat, since it costs
nothing architecturally beyond §4 — but nothing here builds either option, and a dedicated sixth seat
is not part of v1.

**Confidence (Q4): HIGH** that v1 ships five seats, not six. **Commitment: analysis-only.**

### 9.2 Q14 answered: what is deliberately out of scope for the first Zofia dev build

**A real, unanimous catch: an earlier draft never gave Q14 its own labeled answer** — the same
exclusions were scattered unlabeled across several sections, with no stated confidence anywhere and
at least one bare "later" the plan-shop convention this task cites explicitly forbids. Consolidated
here, each with its own justification, matching that convention:

1. **Any OS target other than Linux/AppImage.** Justification: the owner's spec names Linux first;
   Windows is a real, separate decision (§1 row 11, §10 item 6), not an oversight or a "someday."
2. **Multi-provider support and local-LLM support** (other subscriptions, local models). Justification:
   the owner's own words name these as "later," and each carries its own terms-of-service or license
   question (§7) this plan does not resolve prematurely — building toward an unresolved legal question
   would be scope this plan can't justify yet.
3. **The public open-source release itself.** Justification: same as above, plus a documentation and
   support surface this plan has not scoped at all.
4. **Turning the free MLLM/MLLLM layer on by default** (§9). Justification: it's for other users
   later, not the owner's own v1 workflow; Sophi-A's own equivalent ships off by default for the same
   reason — no reason exists here to ship differently.
5. **A dedicated advisor seat** (§9.1). Justification: the owner's binding spec names five seats, not
   six; a sixth seat is unrequested scope, which is itself a defect per this chain's own build rules.
6. **Transcript JSONL as a default observation source** (§2.1). Justification: it reads a session's
   full content unasked; the week-1 probe (§8) decides whether any single field is worth the
   owner-consented opt-in toggle, but the toggle itself, not a default read, is what ships in v1.
7. **Corner-session PTY attachment, under any name.** Justification: not a scope choice — §4
   establishes this is architecturally impossible for a terminal the owner opened himself, not merely
   undesirable; naming it here is a reminder, not a new exclusion.
8. **Any claim that the debate mechanism improves outcomes** (§12, Fixed Premise 4). Justification:
   the mechanism is unmeasured; asserting otherwise would be the exact violation Fixed Premise 4
   exists to prevent.

**Confidence (Q14): HIGH** — every item above traces to a specific fixed premise, an explicit owner
statement, or a confirmed architectural fact, not a preference. **Commitment: no** — this section is
itself the record of what's *not* committed, which is its whole purpose.

## 10. Decisions that still need the owner directly, in order

1. **Read Anthropic's current consumer terms of service himself** (§7) — this gates real-subscription
   center-seat testing specifically, so it comes first.
2. **Confirm the statusline-shim install mechanism** (§2.1) doesn't conflict with anything he already
   has configured, before the week-1 probe starts.
3. **Measure his actual screen** to replace §4's placeholder breakpoint/pane-floor values.
4. **Pick the actual C&C model** (§3) — left configurable, but v1 ships with something.
5. **Authorize (or not) any escalation past the safest response** in §8's falsification triggers,
   each time one actually fires — an owner decision per occurrence, not a one-time setting.
6. **Confirm whether Windows packaging is ever reopened** (§1, §6) — deliberately dropped for v1
   rather than assumed wanted later.
7. **Decide real effort-tier values** (§5) once the week-1 probe shows what's actually configurable.

**Three plan-changing results, named explicitly** (not exhaustive — §8's triggers are the load-bearing
ones): (a) the statusline JSON is missing enough fields that the reader's whole value proposition
narrows to "model + last-active" only — reopens §2 before building further; (b) the packaged artifact
can't run on any distro the owner actually uses — reopens §6's toolkit choice; (c) the mock center-PTY
exercise can't demonstrate interactive parity at all — reopens §3's whole mechanism, not just its
fallback.

## 11. 7-year roadmap

**Year 1 — concrete commitment.** The v1 build in §8's order: the observation bridge and reader (§2),
the shell layout (§4), the center seat (§3), Linux packaging (§6), with the privacy constraints (§2.3)
enforced throughout and audited fully at the end.

**Year 2 — a review checkpoint, illustrative year, not a committed delivery.** Trigger: `IF` (i) the
owner has verified Anthropic's ToS himself (§7), `AND` (ii) he explicitly commits to an open-source
release in this window. Otherwise the checkpoint rolls forward un-entered. Candidate scope if
triggered: the public repo, and the multi-provider/local-LLM extensions §7 already scopes as later.

**Years 3-7 — each an `IF`-gated review, never a fixed commitment.** `IF` the prior year's checkpoint
approves extending the roadmap, the next year's review opens; otherwise Zofia is feature-frozen at the
prior year. Naming concrete engineering work this far out would assert confidence this plan doesn't
have — the fact pack itself documents chains added and retired, pricing changed, and a whole harness
assumption changed within weeks.

**Confidence: HIGH** on year 1's shape (it's just §8's own slices in order); **deliberately no
confidence claimed** on years 2-7's content — the entire point of the `IF`-gate shape is to avoid
asserting that far out.

## 12. Software-engineering philosophy

- **An impossibility, once confirmed, is a wall, not a design preference.** §4's "corners render
  state, never terminal bytes" rule exists because attaching a read-only PTY to a terminal the owner
  opened himself is not achievable on Linux without tooling this plan never authorizes — three
  separate proposals tried to design around this and were each caught making the same category error.
- **Silence is not a status.** §2's `idle`-after-timeout bug and §2.2's `mtime`-as-last-active bug are
  the same mistake in two places: treating the absence of a signal as a positive fact. Both were fixed
  to distinguish "confirmed" from "we haven't heard anything," which is a different fact.
- **A restriction is not hardening until it's measured against the real thing.** §3's tool-policy
  fix — from "denies Bash and Write" to an allow-list *plus a scripted probe against the actual
  installed CLI* — is the same discipline as §2.2's field matrix: a claim about what a system does is
  only as good as the test that checked it.
- **Defense in depth beats "moved upstream."** §5's provider config keeps the runtime backend
  rejection of `xai`/`grok` in place *even though* a build-time schema check also exists, because a
  build-time gate protects only what's declared at build time, and a model can arrive by other paths
  at runtime.
- **A hard requirement needs a test that fails for the right reason.** §2.3's privacy test was
  rewritten from a host-wide packet capture (which would false-fail on the corner sessions' and center
  child's own legitimate traffic) to a PID-scoped trace — not because the rule was wrong, but because
  a test that cries wolf teaches its own operator to ignore it.
- **Not a certification.** Per Fixed Premise 4, no claim is made anywhere in this document, including
  here, about whether debate improves plans — the mechanism is unmeasured and stays unmeasured until
  someone actually measures it. What's recorded instead, as changelog: the specific things named
  above changed between an earlier draft and this one. Naming what changed is not the same claim as
  saying the changing made things better; only the first is made here.

## Scope ledger

- GPT6ASTRA-1 - accepted - canonical session observation bridge (§2.1), merged with FABLE51-1.
- GPT6ASTRA-2 - accepted - canonical center C&C seat (§3), merged with FABLE51-2.
- GPT6ASTRA-3 - accepted - canonical Linux packaging (§6), stands unopposed.
- FABLE51-1 - accepted - merged into GPT6ASTRA-1 (§2.1); its concrete shim/transport mechanics survive.
- FABLE51-2 - accepted - merged into GPT6ASTRA-2 (§3); its hardened-settings-file mechanics survive.
- FABLE51-3 - accepted - canonical provider/effort config (§5), resolving the orphaned cycle with MUSESPARK12-3.
- GEMINI38FLASH-1 - accepted - folded into the merged observation bridge (§2.1); its own amend converged on the same design as GPT6ASTRA-1/FABLE51-1.
- GEMINI38FLASH-2 - withdrawn - by its author in favour of MUSESPARK12-2 (§4); its Svelte component was a real, caught bug (Premise 1 violation).
- GEMINI38FLASH-3 - withdrawn - by its author in favour of GLM53-3 (§8).
- MUSESPARK12-1 - withdrawn - by its author, folded into the merged observation bridge (§2.1); its duration-field and mtime guesses were caught and fixed there instead.
- MUSESPARK12-2 - accepted - canonical shell layout (§4).
- MUSESPARK12-3 - withdrawn - part of the orphaned provider-config cycle; folded into FABLE51-3 (§5).
- QWEN38MAX-1 - accepted - this document's own spine (§0-§12 structure) follows it directly.
- QWEN38MAX-2 - accepted - the confidence/commitment-status/dissent discipline used in every §-answer throughout this document follows its accepted design.
- QWEN38MAX-3 - accepted - narrowed per its own author's amend to the final ordered owner-decision list (§10); its provenance-table and early-slice content deferred to GLM53-2 and GLM53-3 respectively, per its own board consensus.
- DEEPSEEKV4PRO-1 - withdrawn - by its author in favour of GLM53-1 (§2.2).
- DEEPSEEKV4PRO-2 - accepted - canonical privacy constraints (§2.3), amended for PID-scoped testing.
- DEEPSEEKV4PRO-3 - withdrawn - by its author in favour of GLM53-3 (§8).
- GLM53-1 - accepted - canonical session-state field availability matrix (§2.2).
- GLM53-2 - accepted - canonical Sophi-A disposition ledger (§1).
- GLM53-3 - accepted - canonical first-two-weeks slice with falsification triggers (§8).

## Assumptions

(1) The orphaned two-proposal cycle around provider/effort config (FABLE51-3/MUSESPARK12-3) was
resolved by adopting FABLE51-3 as the landing point, since every other lab's merge post names it
directly, while explicitly carrying forward the one correction (defense-in-depth runtime rejection)
raised against it. (2) QWEN38MAX-3's own board consensus asked that its provenance-table and
early-slice content defer to GLM53-2 and GLM53-3 rather than duplicate them; this plan follows that
consensus and credits QWEN38MAX-3 narrowly for the owner-decision list it uniquely contributes. (3)
Where a proposal's board showed real, substantive disagreement that was resolved by amendment (the
idle/stale semantics, the tool-policy allow-list, the egress test's process-attribution, the
effort-to-budget guess), this document states the correction and the reason for it in place, rather
than only in the Scope ledger, since a reader should be able to see what changed without
cross-referencing BOARD.md. (4) The request requires this document to end with the owner-decision
list; §10 is where that list is first built and cross-referenced from throughout the plan, so it
stays there for narrative coherence, and is repeated verbatim, unchanged, as the document's actual
final section below — satisfying "ends with" literally without moving the load-bearing cross-reference
target mid-document.

## Decisions that still need the owner directly, in order (repeated here, to end the document as required)

1. **Read Anthropic's current consumer terms of service himself** (§7) — this gates real-subscription
   center-seat testing specifically, so it comes first.
2. **Confirm the statusline-shim install mechanism** (§2.1) doesn't conflict with anything he already
   has configured, before the week-1 probe starts.
3. **Measure his actual screen** to replace §4's placeholder breakpoint/pane-floor values.
4. **Pick the actual C&C model** (§3) — left configurable, but v1 ships with something.
5. **Authorize (or not) any escalation past the safest response** in §8's falsification triggers, each
   time one actually fires — an owner decision per occurrence, not a one-time setting.
6. **Confirm whether Windows packaging is ever reopened** (§1, §6) — deliberately dropped for v1
   rather than assumed wanted later.
7. **Decide real effort-tier values** (§5) once the week-1 probe shows what's actually configurable.
## Appendix: C&C edits (thcmcp-aa), 2026-09-22

The council's own deliverable is unedited in THCMCP `runs/2026-09-22T16-38-54-363Z/deliverable.md`.
This copy carries two additions, both from a blind comparison against the cheap run's plan, judged by
a session that saw neither run's identity:

1. **§4 pane floor** (above): §10 promised a pane-floor value that §4 never stated.
2. **Cost of being wrong** (below): both plans named what gets reopened when a bet fails, but neither
   put a size on it. Estimates in build-days, stated as estimates, not commitments.

### Cost of being wrong

- **The week-1 probe finds the statusline fields unreadable** (the central bet): items 3 and 4 lose
  their data source. Sunk: the probe itself, about 3-5 build-days. The fallback ladder in §8 is then
  the product, not a contingency, so the owner decides whether a GUI showing mostly `UNKNOWN` chips is
  still worth building before item 3 starts.
- **The owner's ToS check rules out driving a `claude` process** (item 8): the center seat is cut.
  Sunk: item 4, about 4-6 build-days against the mock. Items 1-3, 5 and 6 are unaffected: they only
  observe. The GUI degrades to a four-pane monitor, which is still most of the owner's own spec.
- **AppImage packaging fails on the target baseline** (item 5): about 2 build-days, and the fallback is
  a plain tarball plus a `.desktop` file. No other item depends on it.
- **A later-year roadmap trigger never fires:** nothing is sunk by design. Years 2-7 are gated, not
  committed, so an unfired trigger costs a review, not rework.
