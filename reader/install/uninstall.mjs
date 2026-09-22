#!/usr/bin/env node
// Hash-checked uninstall: restores only if the install record's saved whole-file hash
// still matches the current settings.json. If the owner (or anything else) hand-edited
// the file since install, this refuses and shows the diff instead of clobbering it
// (PLAN.md §2.1).

import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { computeUninstallPatch } from "../src/settingsPatch.mjs";

const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const DEFAULT_ZOFIA_DIR = path.join(os.homedir(), ".claude", "zofia");

function parseArgs(argv) {
  const out = { apply: false, yes: false, settingsPath: DEFAULT_SETTINGS_PATH, zofiaDir: DEFAULT_ZOFIA_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--yes") out.yes = true;
    else if (a === "--settings-path") out.settingsPath = argv[++i];
    else if (a === "--zofia-dir") out.zofiaDir = argv[++i];
    else {
      process.stderr.write(`uninstall.mjs: unrecognized argument "${a}"\n`);
      process.exit(2);
    }
  }
  return out;
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
  const recordPath = path.join(args.zofiaDir, "install-record.json");

  let record;
  try {
    record = JSON.parse(await readFile(recordPath, "utf8"));
  } catch (err) {
    process.stderr.write(`uninstall.mjs: no install record at ${recordPath} (${err.code === "ENOENT" ? "nothing to uninstall" : err.message})\n`);
    return 1;
  }

  const currentText = await readFile(args.settingsPath, "utf8");
  const currentHash = sha256(currentText);
  if (currentHash !== record.settings_sha256_after) {
    process.stderr.write(
      `uninstall.mjs: ${args.settingsPath} has changed since Zofia installed (hash mismatch) — refusing to touch it automatically.\n` +
        `Recorded hash: ${record.settings_sha256_after}\nCurrent hash:  ${currentHash}\n\n` +
        `--- current settings.json ---\n${currentText}\n` +
        `A backup of the pre-install file is at: ${record.backup_path}\nHand-edit the file yourself, or diff it against that backup.\n`
    );
    return 1;
  }

  const currentSettings = JSON.parse(currentText);
  const { nextSettings, changes } = computeUninstallPatch(currentSettings, record);
  const nextText = JSON.stringify(nextSettings, null, 2) + "\n";

  process.stdout.write(`Zofia shim uninstall — target: ${args.settingsPath}\n\nPlanned changes:\n`);
  for (const c of changes) process.stdout.write(`  - ${c}\n`);
  process.stdout.write(`\n--- resulting settings.json ---\n${nextText}`);

  if (!args.apply || !args.yes) {
    process.stdout.write("\nDry run only (pass --apply --yes to write). Nothing was changed.\n");
    return 0;
  }

  await atomicWrite(args.settingsPath, nextText);
  await rm(recordPath);
  process.stdout.write("\nUninstalled. Install record removed; the pre-install backup is left in place for reference.\n");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`uninstall.mjs: ${err.message}\n`);
    process.exit(1);
  }
);
