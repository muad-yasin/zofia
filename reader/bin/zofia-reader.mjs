#!/usr/bin/env node
// zofia-reader — HANDOFF.md item 1 (week 1, Track A). Prints one JSON SessionSnapshot
// (PLAN.md §2.2's nine fields, each with a source tag) for one registered session.
//
// Privacy, by construction, not by promise (PLAN.md §2.1, §2.3, §9.2 item 6):
// this file contains no code path that opens a transcript JSONL file. It only reads
// the shim's own small per-session state file. That is the whole "default run opens
// no transcript file" acceptance test — there's nothing to disable, because there's
// nothing here that could open one.

import { deriveSnapshot } from "../src/deriveSnapshot.mjs";
import { readSessionState, resolveSessionId, listRegisteredSessions, sessionsDir } from "../src/sessionState.mjs";

function parseArgs(argv) {
  const out = { session: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session" || a === "-s") out.session = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      process.stderr.write(`zofia-reader: unrecognized argument "${a}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: zofia-reader --session <session_id>",
      "",
      "Prints one JSON SessionSnapshot for a session the Zofia shim has observed.",
      "Registration is explicit: pass --session, or set ZOFIA_SESSION_ID.",
      "This command never reads a session's transcript file.",
      "",
    ].join("\n")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const sessionId = resolveSessionId({ sessionFlag: args.session });
  if (!sessionId) {
    const known = await listRegisteredSessions();
    process.stderr.write("zofia-reader: no --session given and ZOFIA_SESSION_ID is unset.\n");
    process.stderr.write(
      known.length
        ? `Registered sessions in ${sessionsDir()}:\n${known.map((s) => `  - ${s}`).join("\n")}\n`
        : `No sessions registered yet in ${sessionsDir()}.\n`
    );
    process.stderr.write("Registration is always explicit — nothing is auto-selected (PLAN.md §2.1).\n");
    return 1;
  }

  let raw;
  try {
    raw = await readSessionState(sessionId);
  } catch (err) {
    process.stderr.write(`zofia-reader: ${err.message}\n`);
    return 2;
  }

  const snapshot = deriveSnapshot(raw);
  process.stdout.write(JSON.stringify({ session_id: sessionId, ...snapshot }, null, 2) + "\n");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`zofia-reader: unexpected error: ${err.stack || err}\n`);
    process.exit(2);
  }
);
