import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInstallPatch, computeUninstallPatch, HOOK_EVENTS } from "../src/settingsPatch.mjs";

const SHIM_DIR = "/opt/zofia/shim";

test("fresh install (no prior statusLine or hooks): wraps nothing, adds all six hook events", () => {
  const { nextSettings, changes, record } = computeInstallPatch({}, { shimDir: SHIM_DIR });
  assert.equal(nextSettings.statusLine.type, "command");
  assert.equal(nextSettings.statusLine.command, `bash ${SHIM_DIR}/statusline-wrapper.sh`);
  assert.equal(record.original_statusline, null);
  for (const event of HOOK_EVENTS) {
    assert.equal(nextSettings.hooks[event].length, 1);
    assert.equal(nextSettings.hooks[event][0].hooks[0].command, `bash ${SHIM_DIR}/hook-writer.sh`);
  }
  assert.equal(record.injected_hooks.length, HOOK_EVENTS.length);
  assert.ok(changes.length > 0);
});

test("existing statusLine command is wrapped, not replaced", () => {
  const settings = { statusLine: { type: "command", command: "bash ~/.claude/statusline-command.sh" } };
  const { nextSettings, record } = computeInstallPatch(settings, { shimDir: SHIM_DIR });
  assert.equal(
    nextSettings.statusLine.command,
    `ZOFIA_ORIGINAL_STATUSLINE_CMD='bash ~/.claude/statusline-command.sh' bash ${SHIM_DIR}/statusline-wrapper.sh`
  );
  assert.deepEqual(record.original_statusline, settings.statusLine);
});

test("existing statusLine with a single quote in it is shell-escaped safely", () => {
  const settings = { statusLine: { type: "command", command: "echo it's fine" } };
  const { nextSettings } = computeInstallPatch(settings, { shimDir: SHIM_DIR });
  assert.match(nextSettings.statusLine.command, /ZOFIA_ORIGINAL_STATUSLINE_CMD='echo it'\\''s fine'/);
});

test("non-command statusLine type is refused rather than guessed at", () => {
  assert.throws(() => computeInstallPatch({ statusLine: { type: "unknown-future-type" } }, { shimDir: SHIM_DIR }), /only knows how to wrap a command-type/);
});

test("pre-existing hook entries for the same event are preserved alongside Zofia's own", () => {
  const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash ~/some-other-hook.sh" }] }] } };
  const { nextSettings } = computeInstallPatch(settings, { shimDir: SHIM_DIR });
  assert.equal(nextSettings.hooks.PreToolUse.length, 2);
  assert.equal(nextSettings.hooks.PreToolUse[0].hooks[0].command, "bash ~/some-other-hook.sh");
  assert.equal(nextSettings.hooks.PreToolUse[1].hooks[0].command, `bash ${SHIM_DIR}/hook-writer.sh`);
});

test("re-running install against an already-installed settings.json is idempotent (no duplicates)", () => {
  const first = computeInstallPatch({}, { shimDir: SHIM_DIR });
  const second = computeInstallPatch(first.nextSettings, { shimDir: SHIM_DIR });
  assert.deepEqual(second.nextSettings, first.nextSettings);
  assert.equal(second.record.injected_hooks.length, 0);
  for (const event of HOOK_EVENTS) assert.equal(second.nextSettings.hooks[event].length, 1);
});

test("install + uninstall round-trips back to the exact original settings object", () => {
  const original = {
    statusLine: { type: "command", command: "bash ~/.claude/statusline-command.sh" },
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash ~/some-other-hook.sh" }] }] },
    someUnrelatedKey: { untouched: true },
  };
  const { nextSettings, record: patchRecord } = computeInstallPatch(original, { shimDir: SHIM_DIR });
  const { nextSettings: restored } = computeUninstallPatch(nextSettings, patchRecord);
  assert.deepEqual(restored, original);
});

test("uninstalling a fresh install (nothing existed before) removes statusLine and hooks entirely, leaves other keys alone", () => {
  const original = { unrelated: 1 };
  const { nextSettings, record } = computeInstallPatch(original, { shimDir: SHIM_DIR });
  const { nextSettings: restored } = computeUninstallPatch(nextSettings, record);
  assert.deepEqual(restored, original);
  assert.ok(!("statusLine" in restored));
  assert.ok(!("hooks" in restored));
});
