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

**2026-09-22, paused at the owner's own request** ("I want to pause") for repo doc
hygiene — this file, `ROADMAP.md`, `docs/README.md`, and the `Review/` folder. Once
that's done, `HANDOFF.md`'s own order says item 4 (center seat against a mock, §3) is
next; nothing here overrides that.

---

## Waiting on the owner — each blocks something specific (`PLAN.md` §10)

1. **Read Anthropic's current consumer ToS himself** — gates real-subscription
   center-seat testing (item 8) only. Doesn't block item 4, which closes fully against a
   mock.
2. **Decide real effort-tier values** — genuinely actionable now, for the first time:
   item 1's probe is done and `docs/field-availability.md` has real measured values.
3. **Measure his actual screen** — replaces §4's placeholder breakpoint/pane-floor pixel
   values with real ones. Not urgent; the shell already works and is tested against the
   placeholders.
4. **Pick the actual C&C model** — item 4's acceptance test needs a real selection to
   fully close, though item 4 can start against the mock without it.
5. **Confirm whether Windows packaging is ever reopened** — not blocking anything
   currently building.

## Real gaps carried from `DECISIONS.md`, not yet resolved

- **Session assignment (item 3) doesn't persist across a GUI restart** — the owner would
  have to re-type each corner's session_id every launch. No persistence design exists
  yet (where it'd live, what format, whether it should even survive a restart given
  registration is meant to be deliberate each time).
- **The real Tauri `invoke("register_session", …)` argument-name conversion has never
  fired at runtime** (item 3) — relies on Tauri v2's documented default
  camelCase/snake_case convention; `cargo test` has no GUI and Playwright runs against
  `vite preview`, not a real Tauri window. First real launch confirms or refutes this.
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

*No completed items yet — the archive discipline above starts working from here
forward: the next item closed in-session moves out of this file into
`TODO-Archive.md`, not just gets a strikethrough.*
