import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = path.join(HERE, "..", "install", "install.mjs");
const UNINSTALL = path.join(HERE, "..", "install", "uninstall.mjs");
const SHIM_DIR = path.join(HERE, "..", "shim");

async function withTmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "zofia-install-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("install.mjs defaults to dry-run: never writes settings.json without --apply --yes", async () => {
  await withTmp(async (dir) => {
    const settingsPath = path.join(dir, "settings.json");
    const original = { statusLine: { type: "command", command: "echo hi" } };
    await writeFile(settingsPath, JSON.stringify(original));

    await exec("node", [INSTALL, "--settings-path", settingsPath, "--zofia-dir", path.join(dir, "zofia"), "--shim-dir", SHIM_DIR]);

    const unchanged = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(unchanged, original);
  });
});

test("install.mjs --apply --yes writes a backup, an install record, and the merged settings", async () => {
  await withTmp(async (dir) => {
    const settingsPath = path.join(dir, "settings.json");
    const zofiaDir = path.join(dir, "zofia");
    const original = { statusLine: { type: "command", command: "echo hi" }, otherStuff: true };
    await writeFile(settingsPath, JSON.stringify(original));

    const { stdout } = await exec("node", [INSTALL, "--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--shim-dir", SHIM_DIR, "--apply", "--yes"]);
    assert.match(stdout, /Installed\./);

    const merged = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.match(merged.statusLine.command, /ZOFIA_ORIGINAL_STATUSLINE_CMD='echo hi'/);
    assert.equal(merged.otherStuff, true);
    assert.ok(merged.hooks.Stop);

    const record = JSON.parse(await readFile(path.join(zofiaDir, "install-record.json"), "utf8"));
    assert.equal(record.settings_path, settingsPath);
    assert.ok(record.backup_path);
    const backup = JSON.parse(await readFile(record.backup_path, "utf8"));
    assert.deepEqual(backup, original);
  });
});

test("uninstall.mjs restores the exact original file when nothing changed since install", async () => {
  await withTmp(async (dir) => {
    const settingsPath = path.join(dir, "settings.json");
    const zofiaDir = path.join(dir, "zofia");
    const original = { statusLine: { type: "command", command: "echo hi" }, otherStuff: true };
    await writeFile(settingsPath, JSON.stringify(original));

    await exec("node", [INSTALL, "--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--shim-dir", SHIM_DIR, "--apply", "--yes"]);
    await exec("node", [UNINSTALL, "--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--apply", "--yes"]);

    const restored = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(restored, original);
  });
});

test("uninstall.mjs refuses when settings.json changed since install (hash mismatch), and doesn't touch the file", async () => {
  await withTmp(async (dir) => {
    const settingsPath = path.join(dir, "settings.json");
    const zofiaDir = path.join(dir, "zofia");
    await writeFile(settingsPath, JSON.stringify({ statusLine: { type: "command", command: "echo hi" } }));

    await exec("node", [INSTALL, "--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--shim-dir", SHIM_DIR, "--apply", "--yes"]);

    const afterInstall = JSON.parse(await readFile(settingsPath, "utf8"));
    afterInstall.someHandEdit = "the owner changed something";
    await writeFile(settingsPath, JSON.stringify(afterInstall));

    await assert.rejects(exec("node", [UNINSTALL, "--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--apply", "--yes"]), (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr, /hash mismatch/);
      return true;
    });

    const stillThere = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(stillThere.someHandEdit, "the owner changed something");
  });
});

test("install.mjs is idempotent: running twice with --apply --yes doesn't duplicate hook entries", async () => {
  await withTmp(async (dir) => {
    const settingsPath = path.join(dir, "settings.json");
    const zofiaDir = path.join(dir, "zofia");
    await writeFile(settingsPath, JSON.stringify({}));

    await exec("node", [INSTALL, "--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--shim-dir", SHIM_DIR, "--apply", "--yes"]);
    await exec("node", [INSTALL, "--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--shim-dir", SHIM_DIR, "--apply", "--yes"]);

    const merged = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(merged.hooks.Stop.length, 1);
  });
});

// Audit F8, 2026-09-23: a second install overwrote the record with "already-ours-skip" and
// no hooks, so uninstall silently left everything in place and the original was lost.
test("install twice, then uninstall, restores the exact original file", async () => {
  await withTmp(async (dir) => {
    const settingsPath = path.join(dir, "settings.json");
    const zofiaDir = path.join(dir, "zofia");
    const original = JSON.stringify({ statusLine: { type: "command", command: "echo mine" }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo other" }] }] } }, null, 2) + "\n";
    await writeFile(settingsPath, original);
    const args = ["--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--shim-dir", SHIM_DIR, "--apply", "--yes"];
    await exec("node", [INSTALL, ...args]);
    const firstRecord = JSON.parse(await readFile(path.join(zofiaDir, "install-record.json"), "utf8"));
    await exec("node", [INSTALL, ...args]);
    const record = JSON.parse(await readFile(path.join(zofiaDir, "install-record.json"), "utf8"));
    assert.deepEqual(record.original_statusline, { type: "command", command: "echo mine" });
    assert.equal(record.backup_path, firstRecord.backup_path);

    await exec("node", [UNINSTALL, "--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--apply", "--yes"]);
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), JSON.parse(original));
  });
});

// C&C reader LOW, 2026-09-23: backups are copies of the owner's settings.
test("installer backups are 0600, and a re-install over unchanged settings doesn't add another", async () => {
  await withTmp(async (dir) => {
    const settingsPath = path.join(dir, "settings.json");
    const zofiaDir = path.join(dir, "zofia");
    await writeFile(settingsPath, JSON.stringify({ theme: "dark" }));
    const args = ["--settings-path", settingsPath, "--zofia-dir", zofiaDir, "--shim-dir", SHIM_DIR, "--apply", "--yes"];
    await exec("node", [INSTALL, ...args]);
    await exec("node", [INSTALL, ...args]); // the settings now differ (Zofia's own entries): a second backup
    await exec("node", [INSTALL, ...args]); // unchanged since the last run: no third
    const { readdir, stat } = await import("node:fs/promises");
    const baks = (await readdir(zofiaDir)).filter((n) => n.endsWith(".bak"));
    assert.equal(baks.length, 2, baks.join(", "));
    for (const b of baks) assert.equal(((await stat(path.join(zofiaDir, b))).mode & 0o777).toString(8), "600");
  });
});

// Research brief 06 (2026-09-25): Claude Code reads settings.json from CLAUDE_CONFIG_DIR when
// it is set; the installer hard-coded ~/.claude. HOME points at a scratch dir too, so a
// regression could never reach the real ~/.claude.
test("install and uninstall default to $CLAUDE_CONFIG_DIR when it is set", async () => {
  await withTmp(async (dir) => {
    const home = path.join(dir, "home");
    const config = path.join(dir, "elsewhere");
    const { mkdir, access } = await import("node:fs/promises");
    await mkdir(path.join(home, ".claude"), { recursive: true });
    await mkdir(config, { recursive: true });
    await writeFile(path.join(home, ".claude", "settings.json"), '{"theme":"home"}');
    await writeFile(path.join(config, "settings.json"), '{"theme":"config"}');
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: config };
    await exec("node", [INSTALL, "--shim-dir", SHIM_DIR, "--apply", "--yes"], { env });
    const patched = JSON.parse(await readFile(path.join(config, "settings.json"), "utf8"));
    assert.ok(patched.hooks?.StopFailure, "the relocated settings.json got the hooks");
    await access(path.join(config, "zofia", "install-record.json"));
    assert.equal(await readFile(path.join(home, ".claude", "settings.json"), "utf8"), '{"theme":"home"}');
    await exec("node", [UNINSTALL, "--apply", "--yes"], { env });
    assert.deepEqual(JSON.parse(await readFile(path.join(config, "settings.json"), "utf8")), { theme: "config" });
  });
});
