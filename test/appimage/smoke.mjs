// HANDOFF.md item 5, PLAN.md §6: smoke-test the packaged AppImage itself, not a dev server.
// "The smoke test must open the GUI, render the corner-and-center shell, stream synthetic
// observation events, and drive a fake center PTY — a bare process-start check does not
// qualify."
//
//   node test/appimage/smoke.mjs <path/to/Zofia.AppImage> [--extract-and-run]
//
// Normally run through test/appimage/run-clean.sh (clean image, Xvfb, --network=none).
// --extract-and-run exercises PLAN.md §6's no-FUSE path (APPIMAGE_EXTRACT_AND_RUN=1).
// Synthetic observation events are a state file written into a temp ZOFIA_SESSIONS_DIR;
// the fake center PTY is test/fixtures/mock-claude.sh. Nothing touches ~/.claude.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchApp, waitFor, sleep } from "./webdriver.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const appImage = path.resolve(process.argv[2] ?? "");
const extractAndRun = process.argv.includes("--extract-and-run");

const sessionsDir = mkdtempSync(path.join(tmpdir(), "zofia-smoke-"));
const mock = path.join(ROOT, "test/fixtures/mock-claude.sh");
const results = [];
const step = (msg) => console.log(`.. ${msg}`);
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const env = {
  ...process.env,
  ZOFIA_SESSIONS_DIR: sessionsDir,
  ZOFIA_CENTER_COMMAND: mock,
  TAURI_WEBVIEW_AUTOMATION: "true",
  ...(extractAndRun ? { APPIMAGE_EXTRACT_AND_RUN: "1" } : {}),
};

let app;
try {
  app = await launchApp(appImage, env);
  const { run, find, findAll, text, textContent, click, setValue, typeIntoTerminal, screenshot } = app;

  // 1. The shell renders: four corners plus the center seat.
  const corners = await waitFor(async () => {
    const c = await findAll(".corner");
    return c.length === 4 ? c : null;
  });
  check("shell renders 4 corners", corners?.length === 4, `${corners?.length ?? 0} found`);
  check("center pane renders", Boolean(await waitFor(() => find("#center-pane"))));

  // 2. Wiring worked: no alert from main.ts (audit #1's capability fix).
  await sleep(1000);
  const errors = await findAll(".wiring-error");
  check("no wiring error banner", errors.length === 0, errors.length ? await text(".wiring-error") : "");

  // 3. Live corner path: assign a session, then write a synthetic state file for it.
  step("assigning corner 1");
  await setValue('input[aria-label="Assign a session to corner 1"]', "smoke-session");
  await click(".corner .assign-form button");
  writeFileSync(
    path.join(sessionsDir, "smoke-session.json"),
    JSON.stringify({
      pid: process.pid,
      latest_statusline: {
        observed_at: Math.floor(Date.now() / 1000),
        model: { id: "claude-sonnet-5", display_name: "SMOKE-MODEL" },
        context_window: { used_percentage: 7 },
        cost: { total_cost_usd: 0.01 },
      },
      latest_hook_event: null,
    }),
  );
  const cornerHasModel = await waitFor(async () => (await text("#corner-grid")).includes("SMOKE-MODEL"));
  check("live snapshot reaches the corner pane", Boolean(cornerHasModel));

  // 4. Fake center PTY: launch, see its prompt, type, see it echoed back.
  step("launching the center seat");
  await setValue(".center-launcher input", "/tmp");
  await click(".center-launcher button");
  const termText = () => textContent(".center-term");
  const ready = await waitFor(async () => (await termText()).includes("MOCK-CLAUDE-READY"));
  if (!ready) {
    step(`launch notice: ${JSON.stringify(await textContent(".center-notice"))}`);
    // Seen on a locked desktop: bytes arrive but nothing paints (no compositor frames).
    step(`bytes received by the pane: ${await run("return document.querySelector('.center-term').dataset.bytesIn || '0';")}`);
  }
  check("center seat launches the mock and renders its output", Boolean(ready));
  check("pane shows the launched model", (await textContent(".center-model")).includes("sonnet"));
  check("launcher hides while the seat runs", await run("return document.querySelector('.center-launcher').offsetParent === null;"));
  step("typing into the terminal");
  await typeIntoTerminal("hello zofia\r");
  const heard = await waitFor(async () => (await termText()).includes("HEARD:hello zofia"));
  check("typed input reaches the mock through the real window", Boolean(heard));

  const shot = path.join(process.env.SMOKE_OUT_DIR ?? tmpdir(), `zofia-smoke${extractAndRun ? "-extract" : ""}.png`);
  writeFileSync(shot, await screenshot());
  console.log(`screenshot: ${shot}`);
} catch (err) {
  check("smoke run completed", false, String(err));
} finally {
  if (app) await app.close();
  let leftover = "";
  try {
    leftover = execFileSync("pgrep", ["-f", mock]).toString().trim();
  } catch {
    /* pgrep exits 1 when nothing matches */
  }
  check("no mock center seat left running after the app closed", leftover === "", leftover);
  rmSync(sessionsDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed${extractAndRun ? " (extract-and-run)" : " (FUSE)"}`);
process.exit(failed ? 1 : 0);
