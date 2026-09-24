import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSnapshot, fmtElapsed } from "../src/deriveSnapshot.mjs";
import { FIELD_KEYS } from "../src/fieldSchema.mjs";

function baseSl(overrides = {}) {
  return {
    observed_at: 1000,
    model: { id: "claude-sonnet-5", display_name: "Sonnet 5" },
    effort: { level: "high" },
    rate_limits: { five_hour: { used_percentage: 10, resets_at: 5000 } },
    context_window: { used_percentage: 5, total_input_tokens: 100, total_output_tokens: 20 },
    cost: { total_cost_usd: 0.1, total_duration_ms: 1000, total_api_duration_ms: 200 },
    ...overrides,
  };
}

test("null raw state -> every one of the nine fields is unknown with a source", () => {
  const snap = deriveSnapshot(null, { now: 1000 });
  for (const key of FIELD_KEYS) {
    if (key === "tokenSpend") {
      assert.equal(snap.tokenSpend.usd.availability, "unknown");
      assert.equal(snap.tokenSpend.tokens.availability, "unknown");
      assert.ok(snap.tokenSpend.usd.source);
      continue;
    }
    assert.equal(snap[key].availability, "unknown", `${key} should be unknown`);
    assert.ok(snap[key].source, `${key} must carry a source string even when unknown`);
  }
});

test("full statusline payload -> model/effort/usage/reset/context/cost all exposed", () => {
  const raw = { latest_statusline: baseSl(), latest_hook_event: null, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 });
  assert.equal(snap.model.availability, "exposed");
  assert.deepEqual(snap.model.value, { id: "claude-sonnet-5", display_name: "Sonnet 5" });
  assert.equal(snap.effort.value, "high");
  assert.equal(snap.usagePercent.value, 10);
  assert.equal(snap.resetTimer.value, 5000);
  assert.equal(snap.contextPercent.value, 5);
  assert.equal(snap.tokenSpend.usd.value, 0.1);
  assert.equal(snap.tokenSpend.usd.availability, "exposed");
  assert.equal(snap.tokenSpend.tokens.availability, "approximable");
  assert.deepEqual(snap.tokenSpend.tokens.value, { input_tokens: 100, output_tokens: 20 });
});

test("rate_limits absent entirely (pre-first-API-response / non-metered) -> usage% and reset timer unknown, never guessed", () => {
  const raw = { latest_statusline: baseSl({ rate_limits: undefined }), latest_hook_event: null, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 });
  assert.equal(snap.usagePercent.availability, "unknown");
  assert.equal(snap.resetTimer.availability, "unknown");
  assert.match(snap.resetTimer.source, /never inferred locally/);
  assert.match(snap.resetTimer.source, /absent entirely/);
});

test("rate_limits present but five_hour missing (real idle-session shape, 2026-09-22 live capture) -> unknown, reason doesn't claim rate_limits is absent", () => {
  const raw = { latest_statusline: baseSl({ rate_limits: { seven_day: { used_percentage: 28, resets_at: 9000 } } }), latest_hook_event: null, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 });
  assert.equal(snap.usagePercent.availability, "unknown");
  assert.equal(snap.resetTimer.availability, "unknown");
  assert.doesNotMatch(snap.usagePercent.source, /rate_limits absent entirely/);
  assert.match(snap.usagePercent.source, /five_hour block is absent/);
});

test("effort absent (model doesn't support reasoning effort) -> unknown, not defaulted", () => {
  const raw = { latest_statusline: baseSl({ effort: undefined }), latest_hook_event: null, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 });
  assert.equal(snap.effort.availability, "unknown");
});

// Quality check Q5: the spec's "XYZ for 49s · done XX:YY", approximated from the hook times.
test("durationLine: unknown until a prompt is seen; 'working for' mid-turn; 'worked for' after Stop", () => {
  const hook = (at, name) => ({ observed_at: at, hook_event_name: name, tool_name: "Bash" });
  const none = deriveSnapshot({ latest_statusline: baseSl(), latest_hook_event: hook(1000, "PreToolUse"), pid: null }, { now: 1000 });
  assert.equal(none.durationLine.availability, "unknown");
  const busy = deriveSnapshot({ latest_statusline: baseSl(), latest_hook_event: hook(1100, "PreToolUse"), turn_started_at: 1000, pid: 7 }, { now: 1250, isProcessAlive: () => true });
  assert.equal(busy.durationLine.value, "working for 4m 10s");
  assert.equal(busy.durationLine.availability, "approximable");
  const done = deriveSnapshot({ latest_statusline: baseSl(), latest_hook_event: hook(1123, "Stop"), turn_started_at: 1000, pid: 7 }, { now: 5000, isProcessAlive: () => true });
  assert.equal(done.durationLine.value, "worked for 2m 3s");
  assert.equal(done.durationLine.observed_at, 1123);
  const dead = deriveSnapshot({ latest_statusline: baseSl(), latest_hook_event: hook(1100, "PreToolUse"), turn_started_at: 1000, pid: 7 }, { now: 1250, isProcessAlive: () => false });
  assert.equal(dead.durationLine.availability, "unknown");
});

test("activity state: PreToolUse -> running tool: <name>", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "PreToolUse", tool_name: "Bash" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1005 });
  assert.equal(snap.activityState.value, "running tool: Bash · 5s");
  assert.equal(snap.activityState.availability, "approximable");
});

test("activity state: Stop -> idle, and stays idle even long after (terminal, not silence)", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "Stop" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 + 10_000 });
  assert.equal(snap.activityState.value, "idle");
});

test("activity state: non-terminal event gone silent with no process to check -> 'stale · last event …', never asserted as still-running or idle", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "PreToolUse", tool_name: "Bash" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 + 121 });
  assert.equal(snap.activityState.value, "stale · last event 2m 1s ago");
  assert.notEqual(snap.activityState.value, "idle");
});

test("activity state: fresh non-terminal event under the stale threshold is NOT marked stale", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "PreToolUse", tool_name: "Bash" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 + 60 });
  assert.equal(snap.activityState.value, "running tool: Bash · 1m 0s");
});

// Quality check Q2: a four-minute build on a live process is the busiest state, never "stale".
test("activity state: a long tool call on a live process shows its elapsed time, never stale", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "PreToolUse", tool_name: "Bash" }, pid: 4242 };
  const snap = deriveSnapshot(raw, { now: 1000 + 250, isProcessAlive: () => true });
  assert.equal(snap.activityState.value, "running tool: Bash · 4m 10s");
  assert.match(snap.activityState.source, /pid 4242 alive/);
});

test("activity state: SessionStart -> ready (waiting for the first prompt), never stale", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "SessionStart" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 + 10_000 });
  assert.equal(snap.activityState.value, "ready");
});

test("fmtElapsed: seconds, minutes, hours", () => {
  assert.equal(fmtElapsed(42), "42s");
  assert.equal(fmtElapsed(250), "4m 10s");
  assert.equal(fmtElapsed(7260), "2h 1m");
});

test("activity state: dead owning process overrides everything else, even a fresh Stop", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "Stop" }, pid: 99999 };
  const snap = deriveSnapshot(raw, { now: 1001, isProcessAlive: () => false });
  assert.equal(snap.activityState.value, "ended (process not running)");
  assert.equal(snap.activityState.availability, "exposed");
});

test("activity state: Notification agent_needs_input -> waiting for input, and never downgraded to stale", () => {
  const raw = {
    latest_statusline: null,
    latest_hook_event: { observed_at: 1000, hook_event_name: "Notification", notification_type: "agent_needs_input" },
    pid: null,
  };
  const snap = deriveSnapshot(raw, { now: 1000 + 10_000 });
  assert.equal(snap.activityState.value, "waiting for input");
});

test("lastActiveTime picks the freshest of statusline/hook observed_at, never file mtime", () => {
  const raw = {
    latest_statusline: baseSl({ observed_at: 500 }),
    latest_hook_event: { observed_at: 900, hook_event_name: "Stop" },
    pid: null,
  };
  const snap = deriveSnapshot(raw, { now: 1000 });
  assert.equal(snap.lastActiveTime.value, 900);
  assert.match(snap.lastActiveTime.source, /never from file mtime/);
});

test("every field in a fully-populated snapshot carries all four provenance keys", () => {
  const raw = { latest_statusline: baseSl(), latest_hook_event: { observed_at: 1000, hook_event_name: "Stop" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 });
  for (const key of FIELD_KEYS) {
    const leaves = key === "tokenSpend" ? [snap.tokenSpend.usd, snap.tokenSpend.tokens] : [snap[key]];
    for (const leaf of leaves) {
      assert.ok("value" in leaf && "availability" in leaf && "source" in leaf && "observed_at" in leaf, `${key} missing provenance keys`);
    }
  }
});
