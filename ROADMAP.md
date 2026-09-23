# ROADMAP

Zofia's status-and-horizon view — one level up from `HANDOFF.md`'s literal,
one-item-at-a-time build order. `PLAN.md` §11 is the source of record for the 7-year
shape below and is never edited just to update status; this file is the live companion
to it. Update status here as items close; the *why* behind a decision belongs in
`DECISIONS.md`, not here. Superseded content moves to `ROADMAP-Archive.md`, never
deleted, never rewritten in place.

## Where we are — 2026-09-23

Items 1-4 and 9 are done and pushed. Two builders now share the checkout (owner's call,
2026-09-23): zofia-8b on item 5 (first AppImage, plus audit #1 capabilities), zofia-26 has
closed items 7 and 9 and its share of the item 1-3 audit fixes (#2-#9 in
`Review/Verify_Items1-3_2026-09-23.md`).

## Year 1 — the concrete build (`PLAN.md` §8/§11, `HANDOFF.md`'s 9 items)

1. ✅ **Reader spike** (§2) — the observation-bridge shim, CLI, and field matrix.
   Installed for real against the owner's own `~/.claude/settings.json` 2026-09-22,
   independently verified safe. Commits `0c5ae5e`, `b530d9e`.
2. ✅ **Static shell** (§4) — the five-pane Tauri shell on sample data. Commit `89ad88a`.
3. ✅ **Wire the reader into the shell** (§2/§4) — real snapshots now reach corner
   panes. Commit `75c34e7`.
4. ✅ **Center seat against a mock** (§3) — `43fc8f9`. The real-CLI tool-policy probe
   and the model-display check wait on items 8 and 7.
5. Not started — **First AppImage build** (§6), independent, buildable any time after
   item 2.
6. ⏳ **Zero-egress audit** (§2.3) — harness and tests built by zofia-26 (`12565ee`). The
   acceptance run against the AppImage waits on `strace` being installed (owner) and
   on item 5 closing.
7. ✅ **Provider/effort config** (§5) — `50ced01` (schema, generator, stale lint) and
   `cc09e9a` (runtime guard). Effort values are `UNKNOWN` placeholders until owner
   decision 7 below.
8. Blocked — **Real-subscription center-seat testing**, blocked on owner decision 1
   below (his own ToS read).
9. ✅ **Scope-ledger lint** (added 2026-09-22 by C&C) — `69e561c`. Warns on three
   ledger-only ids in PLAN.md; see `DECISIONS.md`.

## Years 2-7 — an `IF`-gated review, never a fixed commitment (`PLAN.md` §11)

**Year 2**, illustrative, not committed: opens only *if* the owner has read Anthropic's
ToS himself *and* explicitly commits to an open-source release in that window.
Candidate scope: the public repo, multi-provider/local-LLM extensions. Otherwise the
checkpoint rolls forward un-entered, indefinitely.

**Years 3-7**: each opens only if the prior year's checkpoint approves extending;
otherwise Zofia stays feature-frozen at the prior year. `PLAN.md` §11 deliberately names
no concrete engineering work this far out — naming any would assert a confidence this
plan doesn't have.

## Explicitly out of scope for year 1, without a new owner decision

Other OS targets, multi-provider/local-LLM support, the public open-source release
itself, a default-on debate layer, a dedicated advisor seat (`HANDOFF.md`'s "what this
session must never do"; `PLAN.md` §9.2).

## Owner decisions gating progress (`PLAN.md` §10, numbered as there)

1. Not done — **Read Anthropic's ToS himself.** Gates item 8 only; item 4 can build and
   close fully against the mock without this.
2. ✅ **Confirm the statusline-shim install doesn't conflict with his setup** — done
   2026-09-22, install applied and independently verified safe.
3. Not done — **Measure his actual screen.** Replaces §4's placeholder
   breakpoint/pane-floor pixel values (1280px/900px, 480×320) with real ones; not
   urgent, the shell already works and is tested against the placeholders.
4. ✅ **Pick the actual C&C model** — resolved 2026-09-23, relayed via thcmcp-aa:
   "Sonnet, latest build" (Claude Code's own `sonnet` alias, not a pinned dated id). See
   `DECISIONS.md`.
5. Situational, not one-time — **Authorize any escalation past the safest response**,
   each time a §8 falsification trigger actually fires.
6. Not done — **Confirm whether Windows packaging is ever reopened.** Not blocking
   anything currently building.
7. Not done, now ripe — **Decide real effort-tier values.** Wasn't answerable until
   item 1's probe reported real numbers; it now has.

Full detail lives elsewhere on purpose, not duplicated here: `PLAN.md` (the plan and its
reasoning), `HANDOFF.md` (build order and acceptance tests), `PROGRESS.md` (done vs.
assumed per item), `DECISIONS.md` (judgment calls and real bugs found), `BUILT.md`
(commit log by Scope-ledger proposal id).
