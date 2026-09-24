// Quality check Q10 (2026-09-23): the Node reader and its Rust port
// (src-tauri/src/session_reader.rs) were kept in sync by hand, each with its own inline
// fixtures. test/reader-parity/*.json is one shared corpus: a raw state file, the clock,
// which pids are alive, and the expected value/availability/observed_at of every field.
// This test holds the Node reader to it; session_reader.rs's `parity_corpus` test holds
// the Rust reader to the same files. `source` text is not compared: it is prose.
//
// To (re)write every `expected` from the Node reader, after reviewing the change:
//   ZOFIA_PARITY_WRITE=1 node --test test/parity.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSnapshot } from "../src/deriveSnapshot.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "reader-parity");
const FIELDS = ["model", "effort", "usagePercent", "resetTimer", "contextPercent", "activityState", "durationLine", "lastActiveTime"];

export function project(snap) {
  const pick = (f) => ({ value: f.value, availability: f.availability, observed_at: f.observed_at });
  return {
    ...Object.fromEntries(FIELDS.map((k) => [k, pick(snap[k])])),
    "tokenSpend.usd": pick(snap.tokenSpend.usd),
    "tokenSpend.tokens": pick(snap.tokenSpend.tokens),
  };
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();

test("the shared parity corpus is not empty", () => {
  assert.ok(files.length >= 10, `only ${files.length} cases in ${DIR}`);
});

for (const file of files) {
  test(`parity: ${file}`, () => {
    const full = path.join(DIR, file);
    const c = JSON.parse(readFileSync(full, "utf8"));
    const got = project(deriveSnapshot(c.state, { now: c.now, isProcessAlive: (pid) => c.alive_pids.includes(pid) }));
    if (process.env.ZOFIA_PARITY_WRITE) {
      writeFileSync(full, JSON.stringify({ ...c, expected: got }, null, 2) + "\n");
      return;
    }
    assert.deepEqual(got, c.expected, c.description);
  });
}
