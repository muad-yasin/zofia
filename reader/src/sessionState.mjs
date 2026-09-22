import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// $XDG_RUNTIME_DIR/zofia/sessions/<session_id>.json — tmpfs, 0700 dir / 0600 files,
// nothing persists across reboot (PLAN.md §2.1's transport). ZOFIA_SESSIONS_DIR lets
// tests and the install/uninstall tooling point at a fixture directory instead.

export function sessionsDir() {
  if (process.env.ZOFIA_SESSIONS_DIR) return process.env.ZOFIA_SESSIONS_DIR;
  const runtimeDir = process.env.XDG_RUNTIME_DIR || "/tmp";
  return path.join(runtimeDir, "zofia", "sessions");
}

export async function listRegisteredSessions() {
  try {
    const entries = await readdir(sessionsDir());
    return entries.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/** @returns {Promise<object|null>} parsed raw state, or null if never observed */
export async function readSessionState(sessionId) {
  const file = path.join(sessionsDir(), `${sessionId}.json`);
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new Error(`session state file for "${sessionId}" is unreadable or not valid JSON: ${err.message}`);
  }
}

/**
 * Registration is explicit, never automatic discovery (PLAN.md §2.1) — this never
 * scans for "the most likely" session on its own; it only resolves an id the caller
 * already named (flag or env var).
 */
export function resolveSessionId({ sessionFlag, env = process.env } = {}) {
  return sessionFlag || env.ZOFIA_SESSION_ID || null;
}
