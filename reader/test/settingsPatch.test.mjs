import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInstallPatch, computeUninstallPatch, mergeInstallRecords, hookWriterCommand, statuslineWrapperCommand, isZofiaWrapper, HOOK_EVENTS } from "../src/settingsPatch.mjs";

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

// Research brief 03 (2026-09-25): the wrapper was recognised only if its path held "zofia",
// so a checkout under any other name wrapped Zofia's own wrapper a second time.
test("a re-install from a checkout whose path has no 'zofia' in it doesn't wrap the wrapper again", () => {
  const shimDir = "/opt/checkout/reader/shim";
  const original = { statusLine: { type: "command", command: "bash ~/.claude/statusline-command.sh it's" } };
  const first = computeInstallPatch(original, { shimDir });
  const second = computeInstallPatch(first.nextSettings, { shimDir });
  assert.deepEqual(second.nextSettings, first.nextSettings);
  assert.equal(second.record.original_statusline, "already-ours-skip");
  assert.ok(isZofiaWrapper(first.nextSettings.statusLine.command));
  assert.ok(!isZofiaWrapper("bash ~/.claude/statusline-command.sh"));
  assert.ok(!isZofiaWrapper("FOO=1 bash /x/statusline-wrapper.sh"), "only the exact shape the installer writes");
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

// Audit F4 + F8, 2026-09-23: upgrading an install made before UserPromptSubmit was added.
test("re-installing over an older hook set adds only the new hook and keeps the first record's original", async () => {
  const shimDir = "/opt/zofia/shim";
  const oldEvents = HOOK_EVENTS.filter((e) => e !== "UserPromptSubmit");
  const cmd = hookWriterCommand(shimDir);
  const installed = {
    statusLine: { type: "command", command: statuslineWrapperCommand(shimDir, "echo mine") },
    hooks: Object.fromEntries(oldEvents.map((e) => [e, [{ hooks: [{ type: "command", command: cmd }] }]])),
  };
  const prior = {
    original_statusline: { type: "command", command: "echo mine" },
    injected_hooks: oldEvents.map((event) => ({ event, command: cmd })),
    backup_path: "/first.bak",
  };
  const { nextSettings, record } = computeInstallPatch(installed, { shimDir });
  assert.deepEqual(record.injected_hooks, [{ event: "UserPromptSubmit", command: cmd }]);
  assert.equal(nextSettings.hooks.UserPromptSubmit.length, 1);

  const merged = mergeInstallRecords(prior, { backup_path: "/second.bak", ...record });
  assert.deepEqual(merged.original_statusline, prior.original_statusline);
  assert.equal(merged.backup_path, "/first.bak");
  assert.equal(merged.injected_hooks.length, HOOK_EVENTS.length);

  const { nextSettings: restored } = computeUninstallPatch(nextSettings, merged);
  assert.deepEqual(restored, { statusLine: { type: "command", command: "echo mine" } });
});
