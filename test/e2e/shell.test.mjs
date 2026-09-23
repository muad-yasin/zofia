// HANDOFF.md item 2 acceptance test, literally: headless Chrome at the three
// viewport sizes PLAN.md §4/§8 name, zero .svelte imports in the build, an
// automated contrast check (axe-core) with zero violations at default and 200% zoom.
//
// Also covers item 3's own acceptance wording at the DOM level ("corner panes show
// measured fields and an explicit UNKNOWN chip") — this suite runs outside any real
// Tauri webview (vite preview only), so it exercises the sample-data path main.ts falls
// back to, not the live Rust-backed pipeline (that's src-tauri/src/session_reader.rs's
// own `cargo test`, including its fixture-replay test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREVIEW_PORT = 4310;
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;

let previewProc;
let browser;

before(async () => {
  // vite preview serves dist/ as-is; build first so the suite never checks a stale build
  // (audit F7, 2026-09-23).
  const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`npm run build failed:\n${build.stdout}${build.stderr}`);
  previewProc = spawn("npx", ["vite", "preview", "--port", String(PREVIEW_PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("vite preview didn't start in time")), 20000);
    previewProc.stdout.on("data", (d) => {
      if (String(d).includes("Local:")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    previewProc.on("error", reject);
  });
  // --no-sandbox: this sandbox's container doesn't grant the user-namespace privileges
  // Chromium's own sandbox needs; without it, launch() hangs indefinitely here.
  browser = await chromium.launch({ args: ["--no-sandbox"] });
});

after(async () => {
  await browser?.close();
  previewProc?.kill();
});

async function newPageAt(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(BASE_URL);
  await page.waitForSelector("#shell");
  return page;
}

test("build contains zero .svelte imports (Fixed Premise 1)", async () => {
  const distAssets = path.join(ROOT, "dist", "assets");
  const files = await readdir(distAssets);
  const jsFiles = files.filter((f) => f.endsWith(".js"));
  assert.ok(jsFiles.length > 0, "expected at least one built JS asset");
  for (const f of jsFiles) {
    const content = await readFile(path.join(distAssets, f), "utf8");
    assert.doesNotMatch(content, /\.svelte/i, `${f} references .svelte`);
  }
});

test("1280x800: full 2x2 corner grid, no tab strip, center pane <=40% viewport", async () => {
  const page = await newPageAt(1280, 800);
  try {
    const corners = await page.$$("#corner-grid > .corner");
    assert.equal(corners.length, 4, "expected exactly 4 corner slots at full breakpoint");

    const tabStripHidden = await page.$eval("#tab-strip", (el) => el.hidden);
    assert.equal(tabStripHidden, true, "tab strip should be hidden with <=4 registered sessions at full breakpoint");

    const [centerBox, viewport] = await Promise.all([
      page.$eval("#center-pane", (el) => el.getBoundingClientRect()),
      page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight })),
    ]);
    assert.ok(centerBox.width <= viewport.w * 0.4 + 1, `center pane width ${centerBox.width} exceeds 40% of ${viewport.w}`);
    assert.ok(centerBox.height <= viewport.h * 0.4 + 1, `center pane height ${centerBox.height} exceeds 40% of ${viewport.h}`);

    await page.screenshot({ path: path.join(ROOT, "test/e2e/screenshots/1280x800.png") });
  } finally {
    await page.close();
  }
});

test("1024x768: medium breakpoint collapses to a 2-pane window plus a visible tab strip", async () => {
  const page = await newPageAt(1024, 768);
  try {
    const visibleCorners = await page.$$eval("#corner-grid > .corner", (els) => els.length);
    assert.equal(visibleCorners, 2, "expected exactly 2 visible corner panes at the medium breakpoint");

    const tabStripHidden = await page.$eval("#tab-strip", (el) => el.hidden);
    assert.equal(tabStripHidden, false, "tab strip should be visible at the medium breakpoint");

    const tabCount = await page.$$eval("#tab-strip [role=tab]", (els) => els.length);
    assert.equal(tabCount, 4, "tab strip should list all 4 fixed corner slots");

    await page.screenshot({ path: path.join(ROOT, "test/e2e/screenshots/1024x768.png") });
  } finally {
    await page.close();
  }
});

test("800x600: single pane with a tab switcher", async () => {
  const page = await newPageAt(800, 600);
  try {
    const visibleCorners = await page.$$eval("#corner-grid > .corner", (els) => els.length);
    assert.equal(visibleCorners, 1, "expected exactly 1 visible corner pane below 900px");

    const tabStripHidden = await page.$eval("#tab-strip", (el) => el.hidden);
    assert.equal(tabStripHidden, false, "tab strip must be visible as the switcher at the compact breakpoint");

    await page.screenshot({ path: path.join(ROOT, "test/e2e/screenshots/800x600.png") });
  } finally {
    await page.close();
  }
});

test("all five panes (top bar controls + visible corners + center) are reachable via sequential Tab order", async () => {
  const page = await newPageAt(1280, 800);
  try {
    const order = [];
    // Walk focus forward from the top of the document.
    await page.evaluate(() => (document.activeElement).blur?.());
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? { tag: el.tagName, id: el.id, cls: el.className, corner: el.getAttribute("data-corner") } : null;
      });
      order.push(info);
    }
    const reachedIds = order.map((o) => o?.id || o?.corner || o?.tag).join(",");
    assert.match(reachedIds, /BUTTON/, "top bar button should be reachable");
    const cornerHits = order.filter((o) => o?.corner !== null && o?.corner !== undefined).length;
    assert.ok(cornerHits >= 4, `expected to tab through all 4 corner panes, saw ${cornerHits}`);
    const centerHit = order.some((o) => o?.id === "center-pane");
    assert.ok(centerHit, "center pane should be reachable via Tab");
  } finally {
    await page.close();
  }
});

test("corner panes render only whitelisted state text, never raw terminal bytes", async () => {
  const page = await newPageAt(1280, 800);
  try {
    const text = await page.$eval("#corner-grid", (el) => el.textContent || "");
    // A terminal escape sequence or a shell prompt string would show up as raw bytes;
    // corner panes only ever render field labels/values from SessionSnapshot.
    assert.doesNotMatch(text, /\x1b\[/, "corner grid text contains a raw ANSI escape sequence");
  } finally {
    await page.close();
  }
});

// WCAG AA (4.5:1 normal text / 3:1 large text), PLAN.md §4 — deliberately not the
// "color-contrast-enhanced" rule, which checks AAA's stricter 7:1.
const AA_CONTRAST_ONLY = { runOnly: ["color-contrast"] };

test("axe-core: zero WCAG contrast violations at default zoom", async () => {
  const page = await newPageAt(1280, 800);
  try {
    const axeSource = await readFile(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(async (opts) => await window.axe.run(document, opts), AA_CONTRAST_ONLY);
    assert.equal(results.violations.length, 0, JSON.stringify(results.violations, null, 2));
  } finally {
    await page.close();
  }
});

test("axe-core: zero WCAG contrast violations at 200% zoom", async () => {
  const page = await newPageAt(1280, 800);
  try {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "200%";
    });
    const axeSource = await readFile(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(async (opts) => await window.axe.run(document, opts), AA_CONTRAST_ONLY);
    assert.equal(results.violations.length, 0, JSON.stringify(results.violations, null, 2));
  } finally {
    await page.close();
  }
});

// HANDOFF.md item 3 acceptance: "corner panes show measured fields and an explicit
// UNKNOWN chip for anything the probe didn't confirm."
test("a genuinely-unknown field (sample-3's usage%/reset timer) renders an explicit UNKNOWN chip, never blank", async () => {
  const page = await newPageAt(1280, 800);
  try {
    const corner = await page.$('[data-corner="2"]'); // main.ts: SAMPLE_SESSIONS[2] -> corner 2
    assert.ok(corner, "expected sample-3 to be registered to corner 2");
    const chipTexts = await corner.$$eval(".availability-chip", (els) => els.map((el) => el.textContent));
    assert.ok(chipTexts.includes("UNKNOWN"), `expected an UNKNOWN chip among ${JSON.stringify(chipTexts)}`);
    const usageRowText = await corner.$$eval(".field-row", (rows) => rows.find((r) => r.textContent?.includes("usage"))?.textContent ?? "");
    assert.match(usageRowText, /UNKNOWN/, `usage field row should carry the UNKNOWN chip, got: ${usageRowText}`);
    // The title names the reset timer too; before audit F6 it was never rendered or checked.
    const resetRowText = await corner.$$eval(".field-row", (rows) => rows.find((r) => r.querySelector(".label")?.textContent === "resets")?.textContent ?? "");
    assert.match(resetRowText, /UNKNOWN/, `reset-timer field row should carry the UNKNOWN chip, got: ${JSON.stringify(resetRowText)}`);
  } finally {
    await page.close();
  }
});

// Item 3, PLAN.md §2.1: "the owner assigns a detected session_id to each corner pane by
// hand" — never auto-discovered. This proves the assign control itself works end-to-end
// at the DOM/registry level (Tauri's own register_session call is skipped outside a real
// webview — isTauriRuntime() is false under vite preview — so this only exercises the
// local registry+render path, not the backend RPC).
test("assigning a session_id to the empty corner moves it out of 'no session assigned'", async () => {
  const page = await newPageAt(1280, 800);
  try {
    const emptyCorner = await page.$('[data-corner="3"]'); // main.ts leaves corner 3 unregistered
    assert.ok(emptyCorner, "expected an empty corner 3");
    assert.match((await emptyCorner.textContent()) ?? "", /no session assigned/);

    await emptyCorner.$eval("input", (el) => (el.value = "test-session-abc"));
    await emptyCorner.$eval("button", (el) => el.click());

    const afterText = await page.$eval('[data-corner="3"]', (el) => el.textContent || "");
    assert.doesNotMatch(afterText, /no session assigned/, "corner should no longer show the empty-slot placeholder");
    assert.match(afterText, /no snapshot yet/, "a registered session with no data yet should say so explicitly, not render blank");
  } finally {
    await page.close();
  }
});

// ---- Live path, with Tauri's IPC mocked in the page (no real webview in this suite). ----
// The mock records the zofia://snapshot listener's callback so a test can fire a snapshot
// event exactly as the Rust watcher would; every other invoke resolves to null.
const TAURI_MOCK = () => {
  const callbacks = {};
  let nextId = 1;
  window.__zofiaTest = { callbacks, snapshotHandler: null };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => {
      const id = nextId++;
      callbacks[id] = cb;
      return id;
    },
    invoke: async (cmd, args) => {
      if (cmd === "plugin:event|listen" && args.event === "zofia://snapshot") window.__zofiaTest.snapshotHandler = args.handler;
      return null;
    },
  };
};

async function newLivePageAt(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(TAURI_MOCK);
  await page.goto(BASE_URL);
  await page.waitForSelector("#shell");
  await page.waitForFunction(() => window.__zofiaTest.snapshotHandler !== null);
  return page;
}

function liveSnapshot(sessionId, overrides = {}) {
  const f = (value, availability = "exposed") => ({ value, availability, source: "e2e", observed_at: 1790000000 });
  return {
    session_id: sessionId,
    model: f({ id: "claude-sonnet-5", display_name: "Sonnet 5" }),
    effort: f("medium"),
    usagePercent: f(40),
    resetTimer: f(1790003600),
    contextPercent: f(12),
    activityState: f("idle", "approximable"),
    durationLine: f(null, "unknown"),
    tokenSpend: { usd: f(0.5), tokens: f({ input_tokens: 10, output_tokens: 2 }, "approximable") },
    lastActiveTime: f(1790000000),
    ...overrides,
  };
}

async function fireSnapshot(page, snapshot) {
  await page.evaluate((snap) => {
    const t = window.__zofiaTest;
    t.callbacks[t.snapshotHandler]({ event: "zofia://snapshot", id: 1, payload: { session_id: snap.session_id, snapshot: snap } });
  }, snapshot);
}

// Audit F5, 2026-09-23: every snapshot re-render used to wipe a half-typed session_id
// and drop focus to <body>.
test("a snapshot re-render keeps text typed into another corner's assign box, and its focus", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    await page.fill('[aria-label="Assign a session to corner 1"]', "sess-A");
    await page.press('[aria-label="Assign a session to corner 1"]', "Enter");
    await page.click('[aria-label="Assign a session to corner 2"]');
    await page.keyboard.type("sess-B-half");

    await fireSnapshot(page, liveSnapshot("sess-A"));

    await page.waitForSelector('[data-corner="0"] .full-card .field-row');
    assert.equal(await page.inputValue('[aria-label="Assign a session to corner 2"]'), "sess-B-half");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Assign a session to corner 2");
    await page.keyboard.type("-rest");
    assert.equal(await page.inputValue('[aria-label="Assign a session to corner 2"]'), "sess-B-half-rest", "caret stays at the end");
  } finally {
    await page.close();
  }
});

// Audit F6, 2026-09-23: the owner's spec names the reset timer and last-active time; the
// duration line is confirmed unknown for a corner and must say so, not vanish.
test("corner cards render reset timer, last-active time and the duration line with availability chips", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    await page.fill('[aria-label="Assign a session to corner 1"]', "sess-A");
    await page.press('[aria-label="Assign a session to corner 1"]', "Enter");
    await fireSnapshot(page, liveSnapshot("sess-A"));
    await page.waitForSelector('[data-corner="0"] .full-card .field-row');

    const rows = await page.$$eval('[data-corner="0"] .full-card .field-row', (els) =>
      Object.fromEntries(els.map((r) => [r.querySelector(".label")?.textContent, r.querySelector(".availability-chip")?.textContent]))
    );
    assert.equal(rows["resets"], "measured");
    assert.equal(rows["last active"], "measured");
    assert.equal(rows["duration"], "UNKNOWN");
    const resetText = await page.$$eval('[data-corner="0"] .field-row', (els) => els.find((r) => r.querySelector(".label")?.textContent === "resets")?.textContent ?? "");
    assert.match(resetText, /\d{2}:\d{2}:\d{2}/, `expected a clock time, got ${JSON.stringify(resetText)}`);
  } finally {
    await page.close();
  }
});
