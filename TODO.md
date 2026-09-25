# TODO

*The live punch list. **Sorted by importance/impact, highest first** — the top of this
file is what to do next, the bottom is context that no longer needs a decision. Anything
completed or retired lives in `TODO-Archive.md`; this file is what is still owed.*

*Two rules keep it useful, the same discipline `~/Projects/SMO/TODO.md` already uses:
**completed work moves to the archive in the same session it closes**, and the
**PRIORITY NOW block is re-pointed whenever what's next actually changes** — a top block
describing yesterday is the failure mode this exists to fix. Long narrative belongs in
`PROGRESS.md`/`DECISIONS.md`, never here.*

---

## PRIORITY NOW

**2026-09-25 evening.** 0.2.0 "ready for strangers" is done (`PROGRESS.md`): new states, the
needs-you queue, the open-source pack, `platform.rs`. **Owner steps that unlock the most:**
(a) re-run `node reader/install/install.mjs` (dry-run first) so his sessions send the three
new hooks. Until then an API error still reads "processing" on his machine. (b) Create the
item 8 clearance file (below). Item 5's signature still waits on his key. After any Rust
change, rebuild the AppImage (`npm run build:appimage`) before the next container run.

---

## Waiting on the owner — each blocks something specific (`PLAN.md` §10)

0. **A release signing key, kept outside the app and the repo** (PLAN.md §6: "the
   signature verifies before launch"). This is the one open part of item 5. No key has
   been generated. It's his key and his choice of tool (e.g. GPG or minisign).

1. **Create the item 8 clearance file himself** (`docs/ITEM-8-CHECKLIST.md` step 2).
   His ToS read is done (2026-09-23, relayed by C&C; see `DECISIONS.md`). The file is the
   last gate before the real-subscription center-seat probe. No session may create it.
2. **Measure his actual screen** — replaces §4's placeholder breakpoint/pane-floor pixel
   values with real ones. Not urgent; the shell already works and is tested against the
   placeholders.
3. **Decide, before item 8 opens: should the center seat get a state card?** (quality
   check Q11, 2026-09-23). The seat launches with `--restricted`, which ignores settings
   files, including the statusLine shim that feeds every corner. So the real seat would
   show a terminal but no model/usage/context card. Options: accept that; or give the seat
   its statusline some other way (e.g. `--settings` with only the shim, which the item 8
   probe would then have to show doesn't widen the tool policy). Not blocking anything yet.
4. **Confirm whether Windows packaging is ever reopened** — not blocking anything
   currently building.

## Open-source follow-ups (research brief 03, 2026-09-25)

- **AppImage-only users can't install the observation bridge.** The hooks run
  `bash <checkout>/reader/shim/...`, and the AppImage ships neither the shim nor the
  installer, so without a checkout nothing feeds the corners. Moving or deleting the checkout
  also breaks a hook on every tool call. Fix: install the shim to a stable
  `~/.local/share/zofia/shim/`. **Not a small change.** Hooks are matched by their exact
  command, so an existing install would get a second set of hooks unless the installer also
  migrates the old path's entries and the install record. The AppImage would have to carry
  the shim and an installer too.
- **Before the first binary release** (brief 03 items 6, 9 and 10): a signed `SHA256SUMS`
  (brief recommends minisign, key kept offline by the owner), CI, third-party licence notices
  for the AppImage's bundled libraries, the glibc floor, a real icon. The owner decides on
  the owner-private names in the repo (`de.sower.zofia`, session names, project names in
  sample data).

## Real gaps carried from `DECISIONS.md`, not yet resolved

- **What actually brings `rate_limits.five_hour` back once absent is still unknown**
  (item 1, `docs/field-availability.md` rows 3-4) — a fresh API response in that session
  is the leading guess from a 5-session sample, not a confirmed trigger.
- **The 120-second activity-staleness threshold is an untuned placeholder** — reused
  from a different bug fix's own number (`PLAN.md` §2.1), never tuned against a real
  session's actual event cadence.
- **The app icon is a generated placeholder, not real design** (item 2) — a gold circle
  on dark, made only so `cargo check` would compile with an icon present. Needs real
  visual design before any real release.

---

*First archive move: "pick the actual C&C model" closed 2026-09-23 (owner decision,
relayed by thcmcp-aa) — see `TODO-Archive.md`.*
