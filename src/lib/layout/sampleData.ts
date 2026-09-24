import type { SessionSnapshot } from "./types.js";

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
    durationLine: field(null, "unknown", "not exposed for a corner session (PLAN.md §2.2)", null),
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
  }),
  sampleSnapshot({
    session_id: "sample-3",
    activityState: field("stale · last event 3m 30s ago", "approximable", "sample data", Math.floor(Date.now() / 1000) - 210),
    usagePercent: field(null, "unknown", "rate_limits absent in this sample (pre-first-API-response)", null),
    resetTimer: field(null, "unknown", "rate_limits absent in this sample (pre-first-API-response)", null),
  }),
];
