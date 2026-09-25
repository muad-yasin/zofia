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
// The time assertions expect a 24-hour clock. Pin the page locale so the suite passes on a
// machine whose system locale is en-US (12-hour, "03:49 PM") too, not just the build host's.
const PAGE_LOCALE = "en-GB";

before(async () => {
  // vite preview serves dist/ as-is; build first so the suite never checks a stale build
  // (audit F7, 2026-09-23).
  const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`npm run build failed:\n${build.stdout}${build.stderr}`);
  // Run vite's own entry point under this node, not through `npx`: killing an npx wrapper
  // leaves the vite server running, which kept the port busy and hung the suite at exit.
  previewProc = spawn(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(PREVIEW_PORT), "--strictPort"], {
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
  const page = await browser.newPage({ viewport: { width, height }, locale: PAGE_LOCALE });
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

// Quality check Q1 (2026-09-23): the center seat opened at 22rem x 16rem (~36 x 11 terminal
// cells) and sat on top of the corners' values, which `space-between` pushed to the inner edge.
test("1280x800 and 1400x900: the center seat opens at the 40% ceiling and covers no corner value", async () => {
  for (const [w, h] of [[1280, 800], [1400, 900]]) {
    const page = await newPageAt(w, h);
    try {
      const center = await page.$eval("#center-pane", (el) => el.getBoundingClientRect().toJSON());
      assert.ok(center.width >= w * 0.4 - 1 && center.height >= h * 0.4 - 1, `${w}x${h}: center seat is ${center.width}x${center.height}, not at the 40% ceiling`);
      const resize = await page.$eval("#center-pane", (el) => getComputedStyle(el).resize);
      assert.equal(resize, "both", "the center seat must have a resize grip");
      const covered = await page.$$eval(".corner .full-card .field-row > span, .corner .activity-headline, .corner .assign-form > *", (els, c) =>
        els.map((el) => ({ text: el.textContent, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top)
          .map(({ text }) => text), center);
      assert.deepEqual(covered, [], `${w}x${h}: corner fields under the center seat`);
    } finally {
      await page.close();
    }
  }
});

// Q7: four corners fit from 2 x 480 + 3 x 12 = 996 px, so 1024 is a full grid now.
test("1024x768: all four corners, no tab strip, nothing under the center seat", async () => {
  const page = await newPageAt(1024, 768);
  try {
    assert.equal(await page.$$eval("#corner-grid > .corner", (els) => els.length), 4);
    assert.equal(await page.$eval("#tab-strip", (el) => el.hidden), true);
    const center = await page.$eval("#center-pane", (el) => el.getBoundingClientRect().toJSON());
    const covered = await page.$$eval(".corner .full-card .field-row > span, .corner .activity-headline, .corner .assign-form > *", (els, c) =>
      els.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top; })
        .map((el) => el.textContent), center);
    assert.deepEqual(covered, []);
    await page.screenshot({ path: path.join(ROOT, "test/e2e/screenshots/1024x768.png") });
  } finally {
    await page.close();
  }
});

test("960x720: medium breakpoint collapses to a 2-pane window plus a visible tab strip", async () => {
  const page = await newPageAt(960, 720);
  try {
    const visibleCorners = await page.$$eval("#corner-grid > .corner", (els) => els.length);
    assert.equal(visibleCorners, 2, "expected exactly 2 visible corner panes at the medium breakpoint");

    const tabStripHidden = await page.$eval("#tab-strip", (el) => el.hidden);
    assert.equal(tabStripHidden, false, "tab strip should be visible at the medium breakpoint");

    const tabCount = await page.$$eval("#tab-strip [role=tab]", (els) => els.length);
    assert.equal(tabCount, 4, "tab strip should list all 4 fixed corner slots");

    await page.screenshot({ path: path.join(ROOT, "test/e2e/screenshots/960x720.png") });
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
    // 14 stops: the empty corner now holds its picker buttons and the paste toggle (Q3).
    for (let i = 0; i < 14; i++) {
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

    await emptyCorner.$eval(".paste input", (el) => (el.value = "test-session-abc"));
    await emptyCorner.$eval(".paste button", (el) => el.click());

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
const TAURI_MOCK = (responses = {}) => {
  const callbacks = {};
  let nextId = 1;
  window.__zofiaTest = { callbacks, snapshotHandler: null, calls: [] };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => {
      const id = nextId++;
      callbacks[id] = cb;
      return id;
    },
    invoke: async (cmd, args) => {
      window.__zofiaTest.calls.push([cmd, args]);
      if (cmd === "plugin:event|listen" && args.event === "zofia://snapshot") window.__zofiaTest.snapshotHandler = args.handler;
      if (cmd === "assignments_get") return responses.assignments_get ?? [];
      if (cmd === "detected_sessions") return responses.detected_sessions ?? [];
      return null;
    },
  };
};

async function newLivePageAt(width, height, responses = {}) {
  const page = await browser.newPage({ viewport: { width, height }, locale: PAGE_LOCALE });
  await page.addInitScript(TAURI_MOCK, responses);
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

// Audit F6, 2026-09-23: the owner's spec names the reset timer and last-active time; Q5/Q6
// (2026-09-24) made the duration line the turn timer and every time relative, with the
// absolute date and time in its tooltip. A reported value carries no chip; an unknown one
// says UNKNOWN, and every row's tooltip is the field's source.
test("corner cards: relative reset and last-active times, the turn line, chips only where not reported", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    await page.fill('[aria-label="Assign a session to corner 1"]', "sess-A");
    await page.press('[aria-label="Assign a session to corner 1"]', "Enter");
    const now = Math.floor(Date.now() / 1000);
    const f = (value, availability = "exposed", observed_at = now) => ({ value, availability, source: `src-${value}`, observed_at });
    await fireSnapshot(page, liveSnapshot("sess-A", { resetTimer: f(now + 3 * 3600 + 12 * 60 + 30), lastActiveTime: f(now - 40), durationLine: f(null, "unknown") }));
    await page.waitForSelector('[data-corner="0"] .full-card .field-row');
    const rows = async () => page.$$eval('[data-corner="0"] .full-card .field-row', (els) =>
      Object.fromEntries(els.map((r) => [r.dataset.field, { text: r.querySelector(".value").textContent, chip: r.querySelector(".availability-chip")?.textContent ?? null, title: r.title }]))
    );
    let r = await rows();
    assert.match(r.resets.text, /^in 3h 12m$/);
    assert.equal(r.resets.chip, null, "a reported value carries no chip");
    assert.match(r["last active"].text, /^4\ds ago$/);
    assert.equal(r.turn.chip, "UNKNOWN");
    assert.equal(r.effort.title, "e2e", "the row tooltip is the field source");
    const when = await page.$eval('[data-corner="0"] [data-field="resets"] time', (t) => t.title);
    assert.match(when, /\d/, "the absolute time is in the tooltip");

    await fireSnapshot(page, liveSnapshot("sess-A", { durationLine: f("worked for 2m 3s", "approximable", now - 60) }));
    await page.waitForFunction(() => document.querySelector('[data-corner="0"] [data-field="turn"] .value').textContent.includes("worked"));
    r = await rows();
    assert.match(r.turn.text, /^worked for 2m 3s · done \d{2}:\d{2} estimated$/);
    assert.equal(r.turn.chip, "estimated");
  } finally {
    await page.close();
  }
});

// Q4: the activity is the corner's headline, coloured by kind, with a glyph and words too.
test("the activity headline leads the card, coloured by kind and never by colour alone", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    await page.fill('[aria-label="Assign a session to corner 1"]', "sess-W");
    await page.press('[aria-label="Assign a session to corner 1"]', "Enter");
    await fireSnapshot(page, liveSnapshot("sess-W", { activityState: { value: "blocked: permission", availability: "approximable", source: "hook", observed_at: 1 } }));
    await page.waitForSelector('[data-corner="0"] .activity-headline[data-kind="blocked"]');
    const h = await page.$eval('[data-corner="0"] .activity-headline', (el) => ({ text: el.textContent, color: getComputedStyle(el).color, first: el.parentElement.children[1] === el }));
    assert.equal(h.text, "◆ blocked: permission");
    assert.equal(h.color, "rgb(217, 138, 131)");
    assert.ok(h.first, "the headline comes right after the name");
    // Brief 04 P2: a finished turn and an API error each get their own glyph, words and colour.
    for (const [value, kind, text, color] of [
      ["your turn", "yourTurn", "● your turn", "rgb(138, 180, 217)"],
      ["failed: rate_limit", "error", "! failed: rate_limit", "rgb(255, 111, 97)"],
    ]) {
      await fireSnapshot(page, liveSnapshot("sess-W", { activityState: { value, availability: "approximable", source: "hook", observed_at: 1 } }));
      await page.waitForSelector(`[data-corner="0"] .activity-headline[data-kind="${kind}"]`);
      const got = await page.$eval('[data-corner="0"] .activity-headline', (el) => ({ text: el.textContent, color: getComputedStyle(el).color }));
      assert.deepEqual(got, { text, color });
    }
  } finally {
    await page.close();
  }
});

// Q8: a snapshot used to rebuild all four corners. Now an unchanged corner is untouched and a
// changed one keeps its element and every row that did not change.
test("snapshots update corners in place: same element, unchanged rows kept, scroll kept", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    await page.fill('[aria-label="Assign a session to corner 1"]', "sess-K");
    await page.press('[aria-label="Assign a session to corner 1"]', "Enter");
    await fireSnapshot(page, liveSnapshot("sess-K"));
    await page.waitForSelector('[data-corner="0"] .full-card .field-row');
    await page.evaluate(() => {
      const c = document.querySelector('[data-corner="0"]');
      c.__mark = "corner";
      c.querySelector('[data-field="model"]').__mark = "model";
      c.querySelector(".activity-headline").__mark = "headline";
      document.querySelector('[data-corner="1"]').__mark = "empty";
    });
    await fireSnapshot(page, liveSnapshot("sess-K", { activityState: { value: "processing · 3s", availability: "approximable", source: "hook", observed_at: 1 } }));
    await page.waitForSelector('[data-corner="0"] .activity-headline[data-kind="working"]');
    const kept = await page.evaluate(() => {
      const c = document.querySelector('[data-corner="0"]');
      return {
        corner: c.__mark,
        model: c.querySelector('[data-field="model"]').__mark,
        headline: c.querySelector(".activity-headline").__mark ?? null,
        empty: document.querySelector('[data-corner="1"]').__mark,
      };
    });
    assert.deepEqual(kept, { corner: "corner", model: "model", headline: null, empty: "empty" });
  } finally {
    await page.close();
  }
});

// Owner decision 2026-09-23, option B: saved assignments come back marked "restored",
// are registered with Rust, and "Clear all corners" forgets them.
test("saved assignments are restored, marked, and cleared by Clear all", async () => {
  const saved = [
    { corner: 1, session_id: "sess-R1", label: "repo R1", assigned_at: 1 },
    { corner: 3, session_id: "sess-R3", label: "repo R3", assigned_at: 1 },
  ];
  const page = await newLivePageAt(1280, 800, { assignments_get: saved });
  try {
    await page.waitForSelector('[data-corner="1"] .restored-chip');
    assert.match(await page.textContent('[data-corner="1"] h2'), /repo R1\s+restored/);
    assert.match(await page.textContent('[data-corner="3"] h2'), /repo R3/);
    assert.ok(await page.$('[data-corner="0"] .assign-form'), "unsaved corners stay empty");
    const registered = await page.evaluate(() => window.__zofiaTest.calls.filter(([c]) => c === "register_session").map(([, a]) => a.sessionId));
    assert.deepEqual(registered, ["sess-R1", "sess-R3"]);
    assert.equal(await page.$(".wiring-error"), null, "no error banner");

    // A new assignment is saved and isn't marked restored.
    await page.fill('[aria-label="Assign a session to corner 1"]', "sess-new");
    await page.press('[aria-label="Assign a session to corner 1"]', "Enter");
    await page.waitForSelector('[data-corner="0"] h2');
    assert.equal(await page.$('[data-corner="0"] .restored-chip'), null);
    const setCall = await page.evaluate(() => window.__zofiaTest.calls.find(([c]) => c === "assignment_set")?.[1]);
    assert.deepEqual(setCall, { corner: 0, sessionId: "sess-new", label: "sess-new" });

    await page.click(".clear-all");
    await page.waitForFunction(() => document.querySelectorAll(".assign-form").length === 4);
    const after = await page.evaluate(() => window.__zofiaTest.calls.map(([c]) => c));
    assert.ok(after.includes("assignments_clear") && after.includes("unregister_all_sessions"), JSON.stringify(after));
    assert.equal(await page.$eval(".clear-all", (b) => b.disabled), true, "nothing left to clear");
  } finally {
    await page.close();
  }
});

// Quality check Q3 (2026-09-23): assigning a corner meant pasting a UUID out of `ls`. An
// empty corner now offers the sessions the shim has seen, named by folder, one click each.
test("an empty corner offers detected sessions by folder, and one click assigns one", async () => {
  const page = await newPageAt(1280, 800); // sample path: SAMPLE_DETECTED, no backend
  try {
    const picks = await page.$$eval('[data-corner="3"] .pick', (els) => els.map((el) => el.querySelector(".pick-name").textContent));
    assert.deepEqual(picks, ["THCMCP", "SMO · 2f9d", "SMO · b83a"], "folders name the sessions; a shared folder adds the id's first 4 chars");
    const detail = await page.textContent('[data-corner="3"] .pick .pick-detail');
    assert.match(detail, /blocked: permission · Opus 5\.5 · \d+s ago/);
    assert.equal(await page.$eval('[data-corner="3"] details.paste', (d) => d.open), false, "the paste box is the fallback, closed");

    await page.click('[data-corner="3"] .pick[data-session-id^="2f9d"]');
    assert.equal(await page.textContent('[data-corner="3"] h2'), "SMO · 2f9d");
    assert.match(await page.textContent('[data-corner="3"]'), /no snapshot yet/);
  } finally {
    await page.close();
  }
});

test("live: a picked session is registered and saved under its folder name; taken ones leave the list", async () => {
  const now = Math.floor(Date.now() / 1000);
  const detected_sessions = [
    { session_id: "sess-zofia", cwd: "/home/u/Projects/Zofia", project: "Zofia", activity: "ready", last_active: now - 5, model: null },
    { session_id: "sess-smo", cwd: "/home/u/Projects/SMO", project: "SMO", activity: "idle", last_active: now - 90, model: "Sonnet 5" },
  ];
  const page = await newLivePageAt(1280, 800, { detected_sessions });
  try {
    await page.waitForSelector('[data-corner="0"] .pick');
    await page.click('[data-corner="0"] .pick[data-session-id="sess-smo"]');
    await page.waitForSelector('[data-corner="0"] h2');
    assert.equal(await page.textContent('[data-corner="0"] h2'), "SMO");
    const calls = await page.evaluate(() => window.__zofiaTest.calls);
    assert.ok(calls.some(([c, a]) => c === "register_session" && a.sessionId === "sess-smo"));
    assert.deepEqual(calls.find(([c]) => c === "assignment_set")?.[1], { corner: 0, sessionId: "sess-smo", label: "SMO" });
    const left = await page.$$eval('[data-corner="1"] .pick', (els) => els.map((el) => el.dataset.sessionId));
    assert.deepEqual(left, ["sess-zofia"], "an assigned session is not offered again");
  } finally {
    await page.close();
  }
});

test("live: with no session detected, the corner says so and opens the paste box", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    await page.waitForSelector('[data-corner="0"] .picker-hint');
    assert.match(await page.textContent('[data-corner="0"] .picker-hint'), /No Claude Code session found yet/);
    assert.equal(await page.$eval('[data-corner="0"] details.paste', (d) => d.open), true);
  } finally {
    await page.close();
  }
});

// Q6: the five-hour usage and reset are the account's, shown once in the top bar from the
// freshest reporting session; the C&C toggle says what it does.
test("the top bar shows the freshest session's five-hour usage, its reset countdown and the time", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    assert.match(await page.textContent("#account"), /^5h usage — · \d{2}:\d{2}$/);
    const now = Math.floor(Date.now() / 1000);
    const f = (value, observed_at) => ({ value, availability: "exposed", source: "statusline", observed_at });
    for (const [corner, id] of [[1, "sess-old"], [2, "sess-new"]]) {
      await page.fill(`[aria-label="Assign a session to corner ${corner}"]`, id);
      await page.press(`[aria-label="Assign a session to corner ${corner}"]`, "Enter");
    }
    await fireSnapshot(page, liveSnapshot("sess-old", { usagePercent: f(20, now - 600), resetTimer: f(now + 7200 + 90, now - 600) }));
    await fireSnapshot(page, liveSnapshot("sess-new", { usagePercent: f(37, now - 5), resetTimer: f(now + 3 * 3600 + 12 * 60 + 30, now - 5) }));
    await page.waitForFunction(() => document.querySelector("#account").textContent.includes("37%"));
    assert.match(await page.textContent("#account"), /^5h usage 37% · resets in 3h 12m · \d{2}:\d{2}$/);
    assert.match(await page.getAttribute("#account", "title"), /^From sess-new:/);

    await page.click(".center-toggle");
    assert.equal(await page.textContent(".center-toggle"), "Show C&C");
  } finally {
    await page.close();
  }
});

// Research brief 04, proposal 1: the "needs you" queue. Waiting sessions are listed in the
// top bar (blocked, then failed, then your turn; each longest wait first), counted in the window title, framed in their corner, marked
// in the tab strip when off screen, and one click or Alt+N away.
function waitingState(value, observed_at) {
  return { activityState: { value, availability: "approximable", source: "e2e", observed_at } };
}

test("needs-you queue: waiting sessions listed longest wait first, counted in the title, one click away", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    assert.equal(await page.textContent("#needs-you"), "nobody waiting");
    assert.equal(await page.title(), "Zofia");
    for (const [corner, id] of [[1, "sess-a"], [2, "sess-b"], [3, "sess-c"]]) {
      await page.fill(`[aria-label="Assign a session to corner ${corner}"]`, id);
      await page.press(`[aria-label="Assign a session to corner ${corner}"]`, "Enter");
    }
    const now = Math.floor(Date.now() / 1000);
    await fireSnapshot(page, liveSnapshot("sess-a", waitingState("blocked: permission", now - 30)));
    await fireSnapshot(page, liveSnapshot("sess-b", waitingState("blocked: permission", now - 240)));
    await fireSnapshot(page, liveSnapshot("sess-c", waitingState("running tool: Bash · 5s", now - 5)));
    await page.waitForFunction(() => document.querySelectorAll("#needs-you .needs-you-item").length === 2);

    const items = await page.$$eval("#needs-you .needs-you-item", (els) => els.map((el) => el.textContent));
    assert.equal(items.length, 2, "only waiting sessions are queued, not working ones");
    assert.match(items[0], /^◆ sess-b · 4m$/, "the longest wait comes first");
    assert.match(items[1], /^◆ sess-a · \d+s$/);
    assert.equal(await page.title(), "(2) Zofia");
    const attention = await page.$$eval(".corner", (els) => els.map((el) => el.dataset.attention ?? ""));
    assert.deepEqual(attention, ["blocked", "blocked", "", ""], "waiting corners are framed; the working one is not");

    await page.click('#needs-you .needs-you-item[data-session-id="sess-b"]');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Session: sess-b");

    await fireSnapshot(page, liveSnapshot("sess-b", waitingState("processing · 2s", now)));
    await page.waitForFunction(() => document.title === "(1) Zofia");
    assert.equal(await page.$eval('[data-corner="1"]', (el) => el.dataset.attention ?? ""), "", "the frame clears when the wait ends");
    await fireSnapshot(page, liveSnapshot("sess-a", waitingState("idle", now)));
    await page.waitForFunction(() => document.title === "Zofia");
    assert.equal(await page.textContent("#needs-you"), "nobody waiting");
  } finally {
    await page.close();
  }
});

test("needs-you queue: a wait behind a tab is marked in the strip, and Alt+N brings it forward", async () => {
  const page = await newLivePageAt(800, 600);
  try {
    await page.fill('[aria-label="Assign a session to corner 1"]', "sess-front");
    await page.press('[aria-label="Assign a session to corner 1"]', "Enter");
    await page.click('#tab-strip [role="tab"]:nth-child(3)');
    await page.fill('[aria-label="Assign a session to corner 3"]', "sess-hidden");
    await page.press('[aria-label="Assign a session to corner 3"]', "Enter");
    await page.click('#tab-strip [role="tab"]:nth-child(1)');
    await page.waitForSelector('.corner[data-key="s:sess-front"]');

    const now = Math.floor(Date.now() / 1000);
    await fireSnapshot(page, liveSnapshot("sess-hidden", waitingState("blocked: permission", now - 60)));
    await page.waitForSelector('#tab-strip [data-attention="blocked"]');
    assert.equal(await page.textContent('#tab-strip [data-attention="blocked"]'), "◆ sess-hidden");
    assert.equal(await page.$('.corner[data-key="s:sess-hidden"]'), null, "the waiting session starts off screen");

    await page.locator("body").focus();
    await page.keyboard.press("Alt+n");
    await page.waitForSelector('.corner[data-key="s:sess-hidden"]');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Session: sess-hidden");
  } finally {
    await page.close();
  }
});

test("needs-you queue: blocked before failed before your turn; a seen failed or your-turn wait leaves it", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    for (const [corner, id] of [[1, "sess-turn"], [2, "sess-fail"], [3, "sess-block"]]) {
      await page.fill(`[aria-label="Assign a session to corner ${corner}"]`, id);
      await page.press(`[aria-label="Assign a session to corner ${corner}"]`, "Enter");
    }
    const now = Math.floor(Date.now() / 1000);
    await fireSnapshot(page, liveSnapshot("sess-turn", waitingState("your turn", now - 900)));
    await fireSnapshot(page, liveSnapshot("sess-fail", waitingState("failed: rate_limit", now - 600)));
    await fireSnapshot(page, liveSnapshot("sess-block", waitingState("blocked: question", now - 10)));
    await page.waitForFunction(() => document.querySelectorAll("#needs-you .needs-you-item").length === 3);
    const order = () => page.$$eval("#needs-you .needs-you-item", (els) => els.map((el) => `${el.dataset.kind}:${el.textContent}`));
    const first = await order();
    assert.match(first[0], /^blocked:◆ sess-block · \d+s$/, "blocked comes first even though it is the newest wait");
    assert.equal(first[1], "error:! sess-fail · 10m");
    assert.equal(first[2], "yourTurn:● sess-turn · 15m");
    const frames = await page.$$eval(".corner", (els) => els.map((el) => el.dataset.attention ?? ""));
    assert.deepEqual(frames, ["yourTurn", "error", "blocked", ""]);

    // Focusing a corner counts as seeing it. Your turn and failed leave the queue; blocked stays.
    for (const id of ["sess-turn", "sess-fail", "sess-block"]) await page.focus(`.corner[data-key="s:${id}"]`);
    await page.waitForFunction(() => document.querySelectorAll("#needs-you .needs-you-item").length === 1);
    assert.deepEqual(await order(), [(await order())[0]]);
    assert.match((await order())[0], /^blocked:/);
    assert.equal(await page.title(), "(1) Zofia");
    assert.equal(await page.$eval('[data-corner="0"] .activity-headline', (el) => el.textContent), "● your turn", "the headline still says what happened");

    // A new wait on a seen session queues again.
    await fireSnapshot(page, liveSnapshot("sess-turn", waitingState("your turn", now - 5)));
    await page.waitForFunction(() => document.querySelectorAll("#needs-you .needs-you-item").length === 2);
  } finally {
    await page.close();
  }
});

// The sample data has no waiting session, so the contrast tests above never saw the queue,
// the frames or the blocked / failed / your-turn colours. This one does.
test("axe-core: zero WCAG contrast violations with blocked, failed and your-turn sessions queued", async () => {
  const page = await newLivePageAt(1280, 800);
  try {
    const now = Math.floor(Date.now() / 1000);
    for (const [corner, id, value] of [[1, "sess-x", "blocked: permission"], [2, "sess-y", "failed: overloaded"], [3, "sess-z", "your turn"]]) {
      await page.fill(`[aria-label="Assign a session to corner ${corner}"]`, id);
      await page.press(`[aria-label="Assign a session to corner ${corner}"]`, "Enter");
      await fireSnapshot(page, liveSnapshot(id, waitingState(value, now - 60)));
    }
    await page.waitForFunction(() => document.querySelectorAll("#needs-you .needs-you-item").length === 3);
    const axeSource = await readFile(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(async (opts) => await window.axe.run(document, opts), AA_CONTRAST_ONLY);
    assert.equal(results.violations.length, 0, JSON.stringify(results.violations, null, 2));
  } finally {
    await page.close();
  }
});
