import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIELD_KEYS } from "../src/fieldSchema.mjs";

const exec = promisify(execFile);
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "zofia-reader.mjs");

async function withFixtureDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "zofia-cli-test-"));
  try {
    await fn(dir);
  } finally {
    await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
  }
}

test("CLI acceptance: prints valid JSON with all nine field keys, each carrying a source tag", async () => {
  await withFixtureDir(async (dir) => {
    await writeFile(
      path.join(dir, "sess-1.json"),
      JSON.stringify({
        latest_statusline: {
          observed_at: 1000,
          model: { id: "claude-sonnet-5", display_name: "Sonnet 5" },
          effort: { level: "high" },
          rate_limits: { five_hour: { used_percentage: 1, resets_at: 2 } },
          context_window: { used_percentage: 1, total_input_tokens: 1, total_output_tokens: 1 },
          cost: { total_cost_usd: 0.01 },
        },
        latest_hook_event: { observed_at: 1000, hook_event_name: "Stop" },
        pid: process.pid,
      })
    );
    const { stdout } = await exec("node", [CLI, "--session", "sess-1"], { env: { ...process.env, ZOFIA_SESSIONS_DIR: dir } });
    const parsed = JSON.parse(stdout);
    for (const key of FIELD_KEYS) {
      assert.ok(key in parsed, `missing field key ${key}`);
      if (key === "tokenSpend") {
        assert.ok(parsed.tokenSpend.usd.source);
        assert.ok(parsed.tokenSpend.tokens.source);
      } else {
        assert.ok(parsed[key].source, `${key} missing a source tag`);
        assert.ok("availability" in parsed[key]);
      }
    }
  });
});

test("CLI: no --session and no ZOFIA_SESSION_ID -> exit 1, lists registered sessions, never guesses", async () => {
  await withFixtureDir(async (dir) => {
    await writeFile(path.join(dir, "some-other-session.json"), JSON.stringify({}));
    await assert.rejects(
      exec("node", [CLI], { env: { ...process.env, ZOFIA_SESSIONS_DIR: dir, ZOFIA_SESSION_ID: "" } }),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /some-other-session/);
        assert.match(err.stderr, /explicit/);
        return true;
      }
    );
  });
});

test("CLI default run never opens a transcript file, even when one is planted right next to the state file with a canary string", async () => {
  await withFixtureDir(async (dir) => {
    const canary = "ZOFIA-CANARY-4f8e2c";
    const transcriptPath = path.join(dir, "sess-2-transcript.jsonl");
    await writeFile(transcriptPath, `{"role":"user","content":"${canary}"}\n`);
    const before = await stat(transcriptPath);

    await writeFile(
      path.join(dir, "sess-2.json"),
      JSON.stringify({
        transcript_path: transcriptPath, // even if a future field names it, default run must not open it
        latest_statusline: { observed_at: 1, model: { display_name: "Sonnet 5" } },
        latest_hook_event: null,
        pid: null,
      })
    );

    const { stdout, stderr } = await exec("node", [CLI, "--session", "sess-2"], { env: { ...process.env, ZOFIA_SESSIONS_DIR: dir } });
    assert.doesNotMatch(stdout, new RegExp(canary));
    assert.doesNotMatch(stderr, new RegExp(canary));

    const after = await stat(transcriptPath);
    assert.equal(after.atimeMs, before.atimeMs, "transcript file's atime changed — something opened it");
  });
});

test("CLI: unregistered session_id (file absent) still returns all nine keys, all unknown", async () => {
  await withFixtureDir(async (dir) => {
    const { stdout } = await exec("node", [CLI, "--session", "never-seen"], { env: { ...process.env, ZOFIA_SESSIONS_DIR: dir } });
    const parsed = JSON.parse(stdout);
    for (const key of FIELD_KEYS) {
      if (key === "tokenSpend") {
        assert.equal(parsed.tokenSpend.usd.availability, "unknown");
      } else {
        assert.equal(parsed[key].availability, "unknown");
      }
    }
  });
});

// Audit F10, 2026-09-23.
import { isValidSessionId, readSessionState, sessionsDir } from "../src/sessionState.mjs";
test("the Node reader refuses path-like session ids and uses a per-user fallback dir", async () => {
  for (const bad of ["../etc/passwd", "a/b", "..", "", "x y"]) {
    assert.equal(isValidSessionId(bad), false, bad);
    await assert.rejects(readSessionState(bad), /not a valid session_id/);
  }
  assert.equal(isValidSessionId("d55b834d-d581-4891-9429-5afbe96e9f96"), true);
  const saved = { z: process.env.ZOFIA_SESSIONS_DIR, x: process.env.XDG_RUNTIME_DIR };
  delete process.env.ZOFIA_SESSIONS_DIR;
  delete process.env.XDG_RUNTIME_DIR;
  try {
    assert.equal(sessionsDir(), `/tmp/zofia-${process.getuid()}/sessions`);
  } finally {
    if (saved.z !== undefined) process.env.ZOFIA_SESSIONS_DIR = saved.z;
    if (saved.x !== undefined) process.env.XDG_RUNTIME_DIR = saved.x;
  }
});
