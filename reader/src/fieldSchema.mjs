// The nine field keys PLAN.md §2.1/§2.2/HANDOFF.md item 1 name. Every leaf value in a
// SessionSnapshot is one of these {value, availability, source, observed_at} records —
// the frontend (and this CLI) must never render a bare value, so a reader can always
// tell a measured fact from a guess (PLAN.md §2.1 "Provenance on every field").

export const FIELD_KEYS = /** @type {const} */ ([
  "model",
  "effort",
  "usagePercent",
  "resetTimer",
  "contextPercent",
  "activityState",
  "durationLine",
  "tokenSpend",
  "lastActiveTime",
]);

export const AVAILABILITY = /** @type {const} */ ({
  EXPOSED: "exposed",
  APPROXIMABLE: "approximable",
  UNKNOWN: "unknown",
});

/**
 * @param {unknown} value
 * @param {"exposed"|"approximable"|"unknown"} availability
 * @param {string} source
 * @param {number|null} observedAt epoch seconds, or null if never observed
 */
export function field(value, availability, source, observedAt) {
  return { value, availability, source, observed_at: observedAt };
}

export function unknownField(source) {
  return field(null, AVAILABILITY.UNKNOWN, source, null);
}
