import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSnapshot } from "../src/deriveSnapshot.mjs";
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

test("durationLine is always unknown for a corner session, regardless of input", () => {
  const raw = { latest_statusline: baseSl(), latest_hook_event: { observed_at: 1000, hook_event_name: "PreToolUse", tool_name: "Bash" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 });
  assert.equal(snap.durationLine.availability, "unknown");
  assert.match(snap.durationLine.source, /center-seat PTY/);
});

test("activity state: PreToolUse -> running tool: <name>", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "PreToolUse", tool_name: "Bash" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1005 });
  assert.equal(snap.activityState.value, "running tool: Bash");
  assert.equal(snap.activityState.availability, "approximable");
});

test("activity state: Stop -> idle, and stays idle even long after (terminal, not silence)", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "Stop" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 + 10_000 });
  assert.equal(snap.activityState.value, "idle");
});

test("activity state: non-terminal event gone stale -> 'stale (last event Ns ago)', never asserted as still-running or idle", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "PreToolUse", tool_name: "Bash" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 + 121 });
  assert.equal(snap.activityState.value, "stale (last event 121s ago)");
  assert.notEqual(snap.activityState.value, "idle");
});

test("activity state: fresh non-terminal event under the stale threshold is NOT marked stale", () => {
  const raw = { latest_statusline: null, latest_hook_event: { observed_at: 1000, hook_event_name: "PreToolUse", tool_name: "Bash" }, pid: null };
  const snap = deriveSnapshot(raw, { now: 1000 + 60 });
  assert.equal(snap.activityState.value, "running tool: Bash");
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
