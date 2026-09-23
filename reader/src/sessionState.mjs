import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// $XDG_RUNTIME_DIR/zofia/sessions/<session_id>.json — tmpfs, 0700 dir / 0600 files,
// nothing persists across reboot (PLAN.md §2.1's transport). ZOFIA_SESSIONS_DIR lets
// tests and the install/uninstall tooling point at a fixture directory instead.

// Without XDG_RUNTIME_DIR the fallback is per-user, never a shared /tmp/zofia (audit F10,
// 2026-09-23). Must match reader/shim/common.sh and src-tauri/src/session_reader.rs.
export function sessionsDir() {
  if (process.env.ZOFIA_SESSIONS_DIR) return process.env.ZOFIA_SESSIONS_DIR;
  if (process.env.XDG_RUNTIME_DIR) return path.join(process.env.XDG_RUNTIME_DIR, "zofia", "sessions");
  return path.join("/tmp", `zofia-${process.getuid()}`, "sessions");
}

/** A session_id becomes a file name: plain tokens only, so "../x" can't leave the dir. */
export function isValidSessionId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/** A sessions dir someone else owns could hold planted state; refuse to read from it. */
async function assertOwnDir(dir) {
  let st;
  try {
    st = await stat(dir);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  if (st.uid !== process.getuid()) {
    throw new Error(`sessions directory ${dir} is owned by uid ${st.uid}, not you; refusing to read it`);
  }
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
  if (!isValidSessionId(sessionId)) {
    throw new Error(`"${sessionId}" is not a valid session_id (letters, digits, "-" and "_" only)`);
  }
  await assertOwnDir(sessionsDir());
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
