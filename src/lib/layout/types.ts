// Mirrors reader/src/fieldSchema.mjs's nine-field shape (PLAN.md §2.1 "provenance on
// every field") — kept as a separate TS declaration rather than a shared import
// because the reader is a standalone Node CLI (PLAN.md §2's own mechanism) and this is
// the browser-side shell (PLAN.md §4); they're deliberately not the same build.

export type Availability = "exposed" | "approximable" | "unknown";

export interface Field<T> {
  value: T | null;
  availability: Availability;
  source: string;
  observed_at: number | null;
}

export interface TokenSpend {
  usd: Field<number>;
  tokens: Field<{ input_tokens: number | null; output_tokens: number | null }>;
}

export interface SessionSnapshot {
  session_id: string;
  model: Field<{ id: string | null; display_name: string }>;
  effort: Field<string>;
  usagePercent: Field<number>;
  resetTimer: Field<number>;
  contextPercent: Field<number>;
  activityState: Field<string>;
  durationLine: Field<string>;
  tokenSpend: TokenSpend;
  lastActiveTime: Field<number>;
}

/** A corner slot: 0-3, fixed regardless of viewport or session count (PLAN.md §4). */
export type CornerIndex = 0 | 1 | 2 | 3;

export interface RegisteredSession {
  sessionId: string;
  /** Registration is always explicit (PLAN.md §2.1) — set by the owner, never inferred. */
  label: string;
  snapshot: SessionSnapshot | null;
  /** Replayed from this boot's saved assignments at launch, not assigned in this run. */
  restored?: boolean;
}
