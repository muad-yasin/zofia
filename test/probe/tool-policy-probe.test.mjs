// Self-test for scripts/tool-policy-probe.mjs (HANDOFF item 8 prep). Never runs the real
// `claude`: the "real CLI" here is a throwaway script that only drops a sentinel file,
// and every clearance file lives in a temp XDG_CONFIG_HOME, never ~/.config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, chmodSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearanceProblem, seatPolicyArgs, isProbeMock, PROBE_MOCK } from "../../scripts/tool-policy-probe.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const PROBE = join(REPO, "scripts/tool-policy-probe.mjs");

// Every run gets a temp --report path: a real-mode run otherwise writes the repo's
// docs/cnc-tool-policy.md, and a fake CLI's report must never land there.
const REPO_REPORT = join(REPO, "docs/cnc-tool-policy.md");
function runProbe(cli, env = {}) {
  const report = join(mkdtempSync(join(tmpdir(), "zofia-report-")), "report.md");
  const r = spawnSync("node", [PROBE, "--cli", cli, "--report", report], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 120_000 });
  return { code: r.status, out: r.stdout + r.stderr, report };
}

function fakeRealCli() {
  const dir = mkdtempSync(join(tmpdir(), "zofia-fake-cli-"));
  const sentinel = join(dir, "ran");
  const cli = join(dir, "claude");
  writeFileSync(cli, `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\n`);
  chmodSync(cli, 0o755);
  return { cli, sentinel };
}

function clearance(text, mode = 0o600) {
  const home = mkdtempSync(join(tmpdir(), "zofia-xdg-"));
  mkdirSync(join(home, "zofia"));
  const path = join(home, "zofia", "item8-owner-clearance");
  if (text !== null) {
    writeFileSync(path, text);
    chmodSync(path, mode);
  }
  return { home, path };
}

const VALID = "ZOFIA ITEM 8 OWNER CLEARANCE\nterms-read: 2026-09-23\n";

test("clean probe mock: every case PASS, exit 0", () => {
  const r = runProbe(PROBE_MOCK);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /overall: PASS/);
  assert.doesNotMatch(r.out, /^(FAIL|INCONCLUSIVE)/m);
  assert.equal((r.out.match(/^PASS /gm) ?? []).length, 11, r.out); // control + 7 denied + 2 hostile + tool-list-exact
});

test("leaking mock: the probe reports FAIL and exits non-zero", () => {
  const r = runProbe(PROBE_MOCK, { MOCK_PROBE_LEAK: "1" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /overall: FAIL/);
  for (const tool of ["Bash", "Write", "Edit"]) assert.match(r.out, new RegExp(`^FAIL\\s+deny-${tool}`, "m"));
  assert.match(r.out, /^FAIL\s+hostile-project-bash .*MCP server/m);
});

test("real CLI without clearance: refused before it runs, and no clearance file appears", () => {
  const { cli, sentinel } = fakeRealCli();
  const { home, path } = clearance(null);
  const r = runProbe(cli, { XDG_CONFIG_HOME: home });
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /REFUSED/);
  assert.equal(existsSync(sentinel), false, "the gated CLI ran");
  assert.equal(existsSync(path), false, "the probe created a clearance file");
});

test("real CLI with a valid clearance: the gate opens (and a silent CLI is INCONCLUSIVE, not PASS)", () => {
  const { cli, sentinel } = fakeRealCli();
  const { home } = clearance(VALID);
  const r = runProbe(cli, { XDG_CONFIG_HOME: home });
  assert.equal(existsSync(sentinel), true, r.out);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /overall: INCONCLUSIVE/);
  assert.doesNotMatch(r.out, /overall: PASS/);
  assert.match(readFileSync(r.report, "utf8"), /\*\*Overall:\*\* INCONCLUSIVE/);
  assert.equal(existsSync(REPO_REPORT), false, "a test run wrote the repo's docs/cnc-tool-policy.md");
});

test("clearance file rules: format, permissions, no links", () => {
  assert.equal(clearanceProblem(clearance(VALID).path), null);
  assert.match(clearanceProblem(clearance(null).path), /no owner clearance/);
  assert.match(clearanceProblem(clearance("terms-read: 2026-09-23\n").path), /OWNER CLEARANCE/);
  assert.match(clearanceProblem(clearance("ZOFIA ITEM 8 OWNER CLEARANCE\nterms-read: yesterday\n").path), /terms-read/);
  assert.match(clearanceProblem(clearance(VALID, 0o666).path), /writable/);
  const real = clearance(VALID);
  const link = clearance(null);
  symlinkSync(real.path, link.path);
  assert.match(clearanceProblem(link.path), /regular file/);
});

test("only the committed probe mock's exact bytes count as the mock", () => {
  assert.equal(isProbeMock(PROBE_MOCK), true);
  const copy = join(mkdtempSync(join(tmpdir(), "zofia-mockcopy-")), "mock.mjs");
  writeFileSync(copy, readFileSync(PROBE_MOCK, "utf8") + "\n// changed\n");
  assert.equal(isProbeMock(copy), false);
});

test("policy flags are read from center_seat.rs, and an unreadable policy is refused, not guessed", () => {
  const { args, allowed } = seatPolicyArgs();
  assert.deepEqual(args, ["--restricted", "--tools", "Read,Grep,Glob", "--strict-mcp-config"]);
  assert.deepEqual(allowed, ["Read", "Grep", "Glob"]);
  assert.throws(() => seatPolicyArgs("fn something_else() {}"), /refusing to guess/);
});
