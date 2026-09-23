#!/usr/bin/env node
// Reversible, diff-confirmed installer for the Zofia observation-bridge shim
// (PLAN.md §2.1). Defaults to --dry-run: it always shows the diff and never writes
// unless the caller passes BOTH --apply and --yes.
//
// This script has never been run against the owner's real ~/.claude/settings.json —
// PLAN.md §10 decision #2 requires his own confirmation first. See DECISIONS.md.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { computeInstallPatch, mergeInstallRecords } from "../src/settingsPatch.mjs";

const READER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SHIM_DIR = path.join(READER_DIR, "shim");
const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const DEFAULT_ZOFIA_DIR = path.join(os.homedir(), ".claude", "zofia");

function parseArgs(argv) {
  const out = { apply: false, yes: false, settingsPath: DEFAULT_SETTINGS_PATH, zofiaDir: DEFAULT_ZOFIA_DIR, shimDir: DEFAULT_SHIM_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--yes") out.yes = true;
    else if (a === "--settings-path") out.settingsPath = argv[++i];
    else if (a === "--zofia-dir") out.zofiaDir = argv[++i];
    else if (a === "--shim-dir") out.shimDir = argv[++i];
    else {
      process.stderr.write(`install.mjs: unrecognized argument "${a}"\n`);
      process.exit(2);
    }
  }
  return out;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new Error(`${file} exists but isn't valid JSON: ${err.message}`);
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function atomicWrite(file, content) {
  const tmp = `${file}.tmp.${process.pid}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const settings = await readJsonIfExists(args.settingsPath);
  const { nextSettings, changes, record } = computeInstallPatch(settings, { shimDir: args.shimDir });
  const nextText = JSON.stringify(nextSettings, null, 2) + "\n";

  process.stdout.write(`Zofia shim install — target: ${args.settingsPath}\n\n`);
  process.stdout.write("Planned changes:\n");
  for (const c of changes) process.stdout.write(`  - ${c}\n`);
  process.stdout.write("\n--- resulting settings.json ---\n");
  process.stdout.write(nextText);

  if (!args.apply || !args.yes) {
    process.stdout.write("\nDry run only (pass --apply --yes to write). Nothing was changed.\n");
    return 0;
  }

  await mkdir(args.zofiaDir, { recursive: true });
  const backupPath = path.join(args.zofiaDir, `settings.json.${Date.now()}.bak`);
  const originalText = JSON.stringify(settings, null, 2) + "\n";
  await writeFile(backupPath, originalText, "utf8");

  await mkdir(path.dirname(args.settingsPath), { recursive: true });
  await atomicWrite(args.settingsPath, nextText);

  const recordPath = path.join(args.zofiaDir, "install-record.json");
  const installRecord = {
    installed_at: new Date().toISOString(),
    settings_path: args.settingsPath,
    shim_dir: args.shimDir,
    // mergeInstallRecords keeps a previous install's backup_path (the true pre-Zofia file).
    ...mergeInstallRecords(await readJsonIfExists(recordPath), { backup_path: backupPath, ...record }),
    settings_sha256_after: sha256(nextText),
  };
  await atomicWrite(recordPath, JSON.stringify(installRecord, null, 2) + "\n");

  process.stdout.write(`\nInstalled. Backup of the previous file: ${backupPath}\n`);
  process.stdout.write(`Install record: ${path.join(args.zofiaDir, "install-record.json")}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`install.mjs: ${err.message}\n`);
    process.exit(1);
  }
);
