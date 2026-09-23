// Shared WebKitWebDriver helpers for the packaged-AppImage tests (smoke.mjs, and the
// live-gap tests built on the same image). Raw W3C WebDriver over fetch; no dependencies.
//
// On this project's hosts WebKitWebDriver answers "unsupported operation" to element
// click/send-keys and to the Actions API, so the DOM is driven by script: `setValue`,
// `click` and `typeIntoTerminal` below. Terminal text enters through xterm's own input
// handler (an `input` event on its helper textarea) and then travels the real path:
// onData -> Tauri IPC -> Rust -> PTY. It does NOT prove OS-level key delivery.
//
// Rendering needs a painting display: under a locked desktop session no frames arrive
// and xterm never paints. Run under Xvfb (test/appimage/run-clean.sh).

import { spawn, execFileSync } from "node:child_process";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` until it returns something truthy, or `ms` passes. Errors count as "not yet". */
export async function waitFor(fn, ms = 15000, step = 250) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* not there yet */
    }
    await sleep(step);
  }
  return last;
}

// A W3C element reference is a one-key object; take its value rather than spelling the key.
const elId = (ref) => Object.values(ref)[0];

/**
 * Starts WebKitWebDriver, launches `appImage` under it with `env`, and returns helpers
 * bound to that session. Always call `close()` (in a finally): it ends the session, stops
 * the driver, and SIGTERMs any `zofia` process the DELETE left running.
 */
export async function launchApp(appImage, env, { port = 4445 } = {}) {
  const driver = spawn("WebKitWebDriver", [`--port=${port}`], { env, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;

  async function wd(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000), // a stuck driver call fails the step, never hangs the run
    });
    const json = await res.json();
    if (json.value && json.value.error) throw new Error(`${method} ${url}: ${json.value.error} ${json.value.message}`);
    return json.value;
  }

  let sid;
  const close = async () => {
    if (sid) await wd("DELETE", `/session/${sid}`).catch(() => {});
    driver.kill();
    await sleep(1500);
    // By exact process name only: a `-f <AppImage path>` pattern also matches the test
    // script's own argv and kills the run.
    try {
      execFileSync("pkill", ["-TERM", "-x", "zofia"]);
    } catch {
      /* nothing left to close */
    }
    await sleep(1500);
  };

  try {
    await waitFor(async () => (await fetch(base + "/status")).ok, 10000);
    const session = await wd("POST", "/session", {
      capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary: appImage, args: [] } } },
    });
    sid = session.sessionId;
  } catch (err) {
    await close();
    throw err;
  }
  const S = `/session/${sid}`;

  const run = async (script, ...args) => wd("POST", `${S}/execute/sync`, { script, args });
  const find = async (css) => elId(await wd("POST", `${S}/element`, { using: "css selector", value: css }));
  const findAll = async (css) => (await wd("POST", `${S}/elements`, { using: "css selector", value: css })).map(elId);
  const text = async (css) => wd("GET", `${S}/element/${await find(css)}/text`);
  const textContent = async (css) => run("return document.querySelector(arguments[0]).textContent;", css);
  const click = async (css) => run("document.querySelector(arguments[0]).click();", css);
  const setValue = async (css, value) =>
    run(
      "const el = document.querySelector(arguments[0]); el.value = arguments[1]; el.dispatchEvent(new Event('input', {bubbles: true}));",
      css,
      value,
    );
  const typeIntoTerminal = async (str) =>
    run(
      "const ta = document.querySelector('.xterm-helper-textarea'); ta.focus();" +
        "ta.dispatchEvent(new InputEvent('input', {data: arguments[0], inputType: 'insertText', bubbles: true}));",
      str,
    );
  const screenshot = async () => Buffer.from(await wd("GET", `${S}/screenshot`), "base64");

  return { wd, run, find, findAll, text, textContent, click, setValue, typeIntoTerminal, screenshot, close };
}
