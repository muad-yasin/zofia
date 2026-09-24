// Real-window tests for behaviour that had only ever been unit-tested or checked against a
// mocked IPC: the packaged AppImage, driven through WebKitWebDriver under Xvfb, with its
// network off (test/appimage/run-live.sh). Each check is built so that only the real
// Rust path can make it pass: no state file is written after the setup step it depends
// on.
//
//   node test/appimage/live-gaps.mjs <path/to/Zofia.AppImage>
//
// Covers (C&C list, 2026-09-23): register_session end to end; the watcher's 15s
// re-derive tick (stale, then ended, with no file write); the assign box keeping its text
// across a live snapshot; keystroke order through fire-and-forget IPC; and the owner's
// option-B persistence across a relaunch.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchApp, waitFor, sleep } from "./webdriver.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const appImage = path.resolve(process.argv[2] ?? "");
const PORT = 4455; // not the smoke's 4445, so both can run at once

// Stand-in for $XDG_RUNTIME_DIR/zofia: sessions/ plus assignments.json beside it.
const zofiaDir = mkdtempSync(path.join(tmpdir(), "zofia-live-"));
chmodSync(zofiaDir, 0o700);
const sessionsDir = path.join(zofiaDir, "sessions");
mkdirSync(sessionsDir, { mode: 0o700 });

const env = {
  ...process.env,
  ZOFIA_SESSIONS_DIR: sessionsDir,
  ZOFIA_CENTER_COMMAND: path.join(ROOT, "test/fixtures/mock-claude.sh"),
  TAURI_WEBVIEW_AUTOMATION: "true",
  APPIMAGE_EXTRACT_AND_RUN: "1",
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const step = (msg) => console.log(`.. ${msg}`);
const now = () => Math.floor(Date.now() / 1000);

function writeState(id, { pid = process.pid, model = "LIVE", hook = null, hookAge = 0 } = {}) {
  writeFileSync(
    path.join(sessionsDir, `${id}.json`),
    JSON.stringify({
      pid,
      latest_statusline: { observed_at: now(), model: { id: "m", display_name: model }, context_window: { used_percentage: 5 } },
      latest_hook_event: hook ? { observed_at: now() - hookAge, hook_event_name: hook, tool_name: "Bash" } : null,
    }),
  );
}

const corner = (i) => `#corner-grid .corner[data-corner="${i}"]`;
const assignInput = (i) => `input[aria-label="Assign a session to corner ${i + 1}"]`;

// Through the real picker (quality check Q3): the session's state file is already in the
// sessions dir, so Rust's detected_sessions must offer it within one 5 s refresh.
async function assign(app, i, id) {
  const pick = `${corner(i)} .pick[data-session-id="${id}"]`;
  const offered = await waitFor(async () => (await app.findAll(pick)).length === 1, 12000, 500);
  check(`the picker in corner ${i + 1} offers ${id}`, Boolean(offered));
  if (offered) await app.click(pick);
}

// A process the "ended" check can kill. Same PID namespace as the app (same container).
const victim = spawn("sleep", ["600"], { stdio: "ignore" });

let app;
try {
  // ---- launch 1 -------------------------------------------------------------------
  app = await launchApp(appImage, env, { port: PORT });
  await waitFor(async () => (await app.findAll(".corner")).length === 4);

  // 1. register_session end to end. The file exists *before* the assignment, and there's
  //    a pause, so no file event can deliver it: only register_session's own immediate
  //    emit can (plus the argument-name conversion sessionId -> session_id).
  step("register_session");
  writeState("live-reg", { model: "LIVE-REG" });
  await sleep(2000);
  await assign(app, 0, "live-reg");
  const reg = await waitFor(async () => (await app.textContent(corner(0))).includes("LIVE-REG"), 5000);
  check("register_session delivers a snapshot for a file written before the assignment", Boolean(reg));

  // 2. The re-derive tick with no file write: the hook event is 110s old at setup, so only
  //    a later re-derive (the 15s tick) can move its elapsed time past 2m. The state names
  //    a live pid (this process), so a long tool call must never read "stale" (Q2).
  step("elapsed time via the re-derive tick (up to ~30s)");
  writeState("live-stale", { hook: "PreToolUse", hookAge: 110 });
  await assign(app, 1, "live-stale");
  const running = await waitFor(async () => (await app.textContent(corner(1))).includes("running tool: Bash · 1m"), 5000);
  check("a PreToolUse shows running tool with its elapsed time", Boolean(running));
  const ticked = await waitFor(async () => /running tool: Bash · 2m \d+s/.test(await app.textContent(corner(1))), 40000, 1000);
  check("the elapsed time moves past 2m without any file write (15s tick in start_watcher)", Boolean(ticked));
  check("a live process's long tool call never reads stale", !(await app.textContent(corner(1))).includes("stale"));

  // 3. Ended with no file write: the state names a live pid; kill it.
  step("ended via the re-derive tick (up to ~20s)");
  writeState("live-end", { pid: victim.pid, hook: "PreToolUse" });
  await assign(app, 2, "live-end");
  await waitFor(async () => (await app.textContent(corner(2))).includes("running tool: Bash"), 5000);
  victim.kill("SIGKILL");
  const ended = await waitFor(async () => (await app.textContent(corner(2))).includes("ended (process not running)"), 30000, 1000);
  check("ended appears after the pid dies, without any file write", Boolean(ended));

  // 4. The assign box keeps half-typed text and focus across a live snapshot.
  step("assign box across a live snapshot");
  await app.run("const el = document.querySelector(arguments[0]); el.focus(); el.value = 'half-typed'; el.setSelectionRange(10, 10);", assignInput(3));
  writeState("live-reg", { model: "LIVE-REG-2" });
  const rerendered = await waitFor(async () => (await app.textContent(corner(0))).includes("LIVE-REG-2"), 5000);
  const box = await app.run(
    "const el = document.querySelector(arguments[0]); return {value: el.value, focused: document.activeElement === el};",
    assignInput(3),
  );
  check("a live snapshot re-rendered the corners", Boolean(rerendered));
  check("the assign box keeps its text and focus", box.value === "half-typed" && box.focused, JSON.stringify(box));

  // 5. Keystroke order: 62 separate xterm input events, each its own fire-and-forget
  //    center_write invoke, must reach the mock in order.
  step("keystroke order into the center seat");
  await app.setValue(".center-launcher input", "/tmp");
  await app.click(".center-launcher button");
  const term = () => app.textContent(".center-term");
  const ready = await waitFor(async () => (await term()).includes("MOCK-CLAUDE-READY"), 15000);
  check("center seat launches the mock", Boolean(ready));
  const seq = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  await app.run(
    "const ta = document.querySelector('.xterm-helper-textarea'); ta.focus();" +
      "for (const ch of arguments[0]) ta.dispatchEvent(new InputEvent('input', {data: ch, inputType: 'insertText', bubbles: true}));",
    seq + "\r",
  );
  const heard = await waitFor(async () => (await term()).match(/HEARD:([A-Za-z0-9]*)/)?.[1], 10000);
  check("62 separate keystrokes arrive in order", heard === seq, `heard ${JSON.stringify(heard)}`);

  // Q12: output over 1 KiB leaves Tauri's direct path for its binary fetch on the channel.
  step("a 3000-byte echo through the output channel");
  const before = Number(await app.run("return document.querySelector('.center-term').dataset.bytesIn || '0';"));
  await app.run(
    "const ta = document.querySelector('.xterm-helper-textarea'); ta.focus();" +
      "ta.dispatchEvent(new InputEvent('input', {data: 'Q'.repeat(3000) + '\\r', inputType: 'insertText', bubbles: true}));",
  );
  const bigEcho = await waitFor(async () => {
    const n = Number(await app.run("return document.querySelector('.center-term').dataset.bytesIn || '0';"));
    return n - before >= 3006 ? n - before : null; // at least HEARD: + 3000 bytes
  }, 10000);
  // xterm's DOM renderer holds only the visible rows, so check the tail made it to the screen.
  const tail = await app.run("return /Q{40}/.test(document.querySelector('.center-term').textContent);");
  check("a 3000-byte line comes back through the channel and renders", Boolean(bigEcho) && tail, `+${bigEcho} bytes`);

  // Q11: when the seat ends on its own, the pane says how, and drops the model line.
  step("the seat reports how it ended");
  check("the model line shows while the seat runs", (await app.textContent(".center-model")).startsWith("Model: sonnet"));
  await app.run(
    "const ta = document.querySelector('.xterm-helper-textarea'); ta.focus();" +
      "for (const ch of 'EXIT\\r') ta.dispatchEvent(new InputEvent('input', {data: ch, inputType: 'insertText', bubbles: true}));",
  );
  const exitNotice = await waitFor(async () => (await app.textContent(".center-notice")).includes("exited"), 10000);
  check("the pane says the seat exited with code 0", exitNotice && (await app.textContent(".center-notice")) === "Center seat exited with code 0.", await app.textContent(".center-notice"));
  check("the model line is gone after exit", (await app.textContent(".center-model")) === "");

  // ---- launch 2: option B ---------------------------------------------------------
  step("relaunch for persistence");
  const saved = JSON.parse(readFileSync(path.join(zofiaDir, "assignments.json"), "utf8"));
  check(
    "assignments.json holds the three corners",
    saved.corners.map((c) => `${c.corner}:${c.session_id}`).join(",") === "0:live-reg,1:live-stale,2:live-end",
    JSON.stringify(saved.corners),
  );
  await app.close();
  app = null;
  app = await launchApp(appImage, env, { port: PORT });
  const restored = await waitFor(async () => (await app.findAll(".restored-chip")).length === 3, 15000);
  check("a relaunch restores the three corners, marked restored", Boolean(restored));
  const regAgain = await waitFor(async () => (await app.textContent(corner(0))).includes("LIVE-REG-2"), 5000);
  check("restored corners are live again (re-registered with Rust)", Boolean(regAgain));
  await app.click(".clear-all");
  const cleared = await waitFor(async () => (await app.findAll(".assign-form")).length === 4, 5000);
  const after = JSON.parse(readFileSync(path.join(zofiaDir, "assignments.json"), "utf8"));
  check("Clear all empties the corners and the saved file", Boolean(cleared) && after.corners.length === 0, JSON.stringify(after));

  // ---- launch 3: no center-seat command (Q11) ---------------------------------------
  step("relaunch without a center-seat command");
  await app.close();
  app = null;
  const { ZOFIA_CENTER_COMMAND: _unset, ...noSeatEnv } = env;
  app = await launchApp(appImage, noSeatEnv, { port: PORT });
  const gated = await waitFor(async () => (await app.textContent(".center-notice")).includes("off until item 8"), 15000);
  check("the pane says the seat is off before anyone clicks Launch", Boolean(gated), await app.textContent(".center-notice"));
  check("Launch is disabled while the seat is off", await app.run("return document.querySelector('.center-launcher button').disabled;"));
} catch (err) {
  check("live-gaps run completed", false, String(err?.stack ?? err));
} finally {
  if (app) await app.close();
  victim.kill("SIGKILL");
  rmSync(zofiaDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed (live gaps)`);
process.exit(failed ? 1 : 0);
