import type { DetectedSession, SessionSnapshot } from "./types.js";

// Week 1, Track B ships on sample data (HANDOFF.md item 2) — no reader wiring yet.
// Shapes match reader/src/deriveSnapshot.mjs's real output exactly, including a
// genuinely `unknown` field, so the "UNKNOWN chip" rendering path gets exercised even
// before item 3 wires up real data.

function field<T>(value: T | null, availability: SessionSnapshot["model"]["availability"], source: string, observedAt: number | null) {
  return { value, availability, source, observed_at: observedAt };
}

export function sampleSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  const now = Math.floor(Date.now() / 1000);
  const base: SessionSnapshot = {
    session_id: "sample-session",
    model: field({ id: "claude-sonnet-5", display_name: "Sonnet 5" }, "exposed", "sample data", now),
    effort: field("xhigh", "exposed", "sample data", now),
    usagePercent: field(37.2, "exposed", "sample data", now),
    resetTimer: field(now + 3 * 3600 + 12 * 60, "exposed", "sample data", now),
    contextPercent: field(18, "exposed", "sample data", now),
    activityState: field("running tool: Bash · 42s", "approximable", "sample data", now),
    durationLine: field("working for 1m 5s", "approximable", "sample data", now - 65),
    tokenSpend: {
      usd: field(0.84, "exposed", "sample data", now),
      tokens: field({ input_tokens: 15200, output_tokens: 640 }, "approximable", "sample data", now),
    },
    lastActiveTime: field(now, "exposed", "sample data", now),
  };
  return { ...base, ...overrides };
}

export const SAMPLE_SESSIONS: SessionSnapshot[] = [
  sampleSnapshot({ session_id: "sample-1" }),
  sampleSnapshot({
    session_id: "sample-2",
    model: field({ id: "claude-opus-5", display_name: "Opus 5" }, "exposed", "sample data", Math.floor(Date.now() / 1000)),
    activityState: field("idle", "approximable", "sample data", Math.floor(Date.now() / 1000)),
    durationLine: field("worked for 2m 3s", "approximable", "sample data", Math.floor(Date.now() / 1000) - 300),
  }),
  sampleSnapshot({
    session_id: "sample-3",
    activityState: field("stale · last event 3m 30s ago", "approximable", "sample data", Math.floor(Date.now() / 1000) - 210),
    usagePercent: field(null, "unknown", "rate_limits absent in this sample (pre-first-API-response)", null),
    resetTimer: field(null, "unknown", "rate_limits absent in this sample (pre-first-API-response)", null),
    durationLine: field(null, "unknown", "no prompt submitted since the shim began recording turn starts", null),
  }),
];

// Sessions an empty corner offers in the dev preview and the e2e suite, where there is no
// backend to ask (quality check Q3). Two share a folder, to show how they are told apart.
export const SAMPLE_DETECTED: DetectedSession[] = (() => {
  const now = Math.floor(Date.now() / 1000);
  return [
    { session_id: "7c1e0b52-9a1d-4c3e-8f00-1a2b3c4d5e6f", cwd: "/home/owner/code/api-server", project: "api-server", activity: "blocked: permission", last_active: now - 40, model: "Opus 5.5" },
    { session_id: "2f9d4a17-0b6c-4e21-9d33-6e5f4a3b2c1d", cwd: "/home/owner/code/webshop", project: "webshop", activity: "running tool: Bash · 3m 5s", last_active: now - 185, model: "Sonnet 5" },
    { session_id: "b83a6c90-5e2f-4d17-a4c8-9f0e1d2c3b4a", cwd: "/home/owner/code/webshop", project: "webshop", activity: "idle", last_active: now - 1500, model: "Sonnet 5" },
  ];
})();
