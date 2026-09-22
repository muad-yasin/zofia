// HANDOFF.md item 2 acceptance test, literally: headless Chrome at the three
// viewport sizes PLAN.md §4/§8 name, zero .svelte imports in the build, an
// automated contrast check (axe-core) with zero violations at default and 200% zoom.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREVIEW_PORT = 4310;
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;

let previewProc;
let browser;

before(async () => {
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
