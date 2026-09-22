# Built

One dated entry per commit, naming the PLAN.md section and Scope-ledger proposal
id(s) it serves (HANDOFF.md's own "files to keep current while building" rule).

- 2026-09-22 — Reader spike (PLAN.md §2, HANDOFF.md item 1; scope ledger
  GPT6ASTRA-1/FABLE51-1/GEMINI38FLASH-1/MUSESPARK12-1 for §2.1, GLM53-1 for §2.2,
  DEEPSEEKV4PRO-2 for §2.3). `reader/shim/` (statusline-wrapper.sh, hook-writer.sh,
  common.sh), `reader/src/` (deriveSnapshot.mjs, fieldSchema.mjs, sessionState.mjs,
  settingsPatch.mjs), `reader/bin/zofia-reader.mjs`, `reader/install/`
  (install.mjs, uninstall.mjs), `docs/field-availability.md`. 45 tests. Commit
  `0c5ae5e`. See PROGRESS.md/DECISIONS.md for what's real-measured vs. doc-sourced.
- 2026-09-22 — Static shell (PLAN.md §4, HANDOFF.md item 2; scope ledger
  MUSESPARK12-2, with GEMINI38FLASH-2's withdrawal already reflected in the plan
  text). `src/lib/layout/` (GridShell.ts, paneRegistry.ts, types.ts, sampleData.ts),
  `src/styles.css`, `src/main.ts`, `index.html`, Tauri v2 scaffold (`src-tauri/`),
  build config matching Sophi-A's own (`package.json`, `tsconfig.json`,
  `vite.config.ts`). Includes the C&C-added pane floor from `b8acccd`. 8 Playwright +
  axe-core tests (`test/e2e/shell.test.mjs`), all passing; `cargo check` run against
  the Rust scaffold. See PROGRESS.md/DECISIONS.md for two real bugs caught and fixed
  during this item (the `#app`-vs-`body` flex container, and the pane-floor's
  content-box-vs-border-box measurement).
