import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHIM_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shim");

async function withSessionsDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "zofia-shim-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// child_process.execFile's async form has no `input` option (that's sync-only) — write
// to the child's stdin and end() it ourselves, or a script that reads stdin via `cat`
// blocks forever.
function runScript(script, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join(SHIM_DIR, script)], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`exit ${code}`), { code, stdout, stderr }));
    });
    child.stdin.end(input ?? "");
  });
}

test("statusline-wrapper.sh: no prior statusLine -> captures state, prints nothing extra", async () => {
  await withSessionsDir(async (dir) => {
    const payload = JSON.stringify({
      session_id: "sess-x",
      model: { id: "claude-sonnet-5", display_name: "Sonnet 5" },
      effort: { level: "medium" },
      rate_limits: { five_hour: { used_percentage: 3, resets_at: 999 } },
      context_window: { used_percentage: 2 },
      cost: { total_cost_usd: 0.05 },
    });
    const { stdout } = await runScript("statusline-wrapper.sh", payload, { ZOFIA_SESSIONS_DIR: dir });
    assert.equal(stdout, "");

    const state = JSON.parse(await readFile(path.join(dir, "sess-x.json"), "utf8"));
    assert.equal(state.latest_statusline.model.display_name, "Sonnet 5");
    assert.equal(state.latest_statusline.effort.level, "medium");
    assert.equal(state.latest_statusline.rate_limits.five_hour.used_percentage, 3);
    assert.equal(typeof state.pid, "number");

    const perms = await stat(path.join(dir, "sess-x.json"));
    assert.equal((perms.mode & 0o777).toString(8), "600");
  });
});

test("statusline-wrapper.sh: wraps an existing statusLine command and passes its stdout through unchanged", async () => {
  await withSessionsDir(async (dir) => {
    const payload = JSON.stringify({ session_id: "sess-y", model: { display_name: "Opus" } });
    const original = `jq -r '"[\\(.model.display_name)] wrapped-ok"'`;
    const { stdout } = await runScript("statusline-wrapper.sh", payload, {
      ZOFIA_SESSIONS_DIR: dir,
      ZOFIA_ORIGINAL_STATUSLINE_CMD: original,
    });
    assert.equal(stdout.trim(), "[Opus] wrapped-ok");
  });
});

test("hook-writer.sh: captures a PreToolUse event with tool_name", async () => {
  await withSessionsDir(async (dir) => {
    const payload = JSON.stringify({ session_id: "sess-z", hook_event_name: "PreToolUse", tool_name: "Edit" });
    const { stdout, stderr } = await runScript("hook-writer.sh", payload, { ZOFIA_SESSIONS_DIR: dir });
    assert.equal(stdout, "");
    assert.equal(stderr, "");
    const state = JSON.parse(await readFile(path.join(dir, "sess-z.json"), "utf8"));
    assert.equal(state.latest_hook_event.hook_event_name, "PreToolUse");
    assert.equal(state.latest_hook_event.tool_name, "Edit");
  });
});

test("statusline and hook writes to the same session interleave safely under concurrency (flock) and always leave valid JSON", async () => {
  await withSessionsDir(async (dir) => {
    const statuslineRuns = Array.from({ length: 8 }, (_, i) =>
      runScript("statusline-wrapper.sh", JSON.stringify({ session_id: "sess-race", model: { display_name: `M${i}` } }), { ZOFIA_SESSIONS_DIR: dir })
    );
    const hookRuns = Array.from({ length: 8 }, (_, i) =>
      runScript("hook-writer.sh", JSON.stringify({ session_id: "sess-race", hook_event_name: "PreToolUse", tool_name: `T${i}` }), { ZOFIA_SESSIONS_DIR: dir })
    );
    await Promise.all([...statuslineRuns, ...hookRuns]);

    const text = await readFile(path.join(dir, "sess-race.json"), "utf8");
    const state = JSON.parse(text); // throws if any interleaved write corrupted the file
    assert.match(state.latest_statusline.model.display_name, /^M\d$/);
    assert.match(state.latest_hook_event.tool_name, /^T\d$/);
  });
});

test("malformed statusline input never corrupts a previously-good state file", async () => {
  await withSessionsDir(async (dir) => {
    await runScript("statusline-wrapper.sh", JSON.stringify({ session_id: "sess-bad", model: { display_name: "Good" } }), { ZOFIA_SESSIONS_DIR: dir });
    await runScript("statusline-wrapper.sh", "not valid json at all", { ZOFIA_SESSIONS_DIR: dir });
    const state = JSON.parse(await readFile(path.join(dir, "sess-bad.json"), "utf8"));
    assert.equal(state.latest_statusline.model.display_name, "Good");
  });
});
