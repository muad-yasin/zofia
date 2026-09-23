// Owner decision 2026-09-23, option B (DECISIONS.md): corner assignments survive a GUI
// restart, not a reboot. Rust keeps them in $XDG_RUNTIME_DIR/zofia/assignments.json
// (src-tauri/src/assignments.rs). No-ops outside a Tauri webview.

import type { CornerIndex } from "../layout/types.js";
import { isTauriRuntime } from "./liveWiring.js";

export interface SavedAssignment {
  corner: CornerIndex;
  session_id: string;
  label: string;
  assigned_at: number;
}

export async function loadAssignments(): Promise<SavedAssignment[]> {
  if (!isTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SavedAssignment[]>("assignments_get");
}

export async function saveAssignment(corner: CornerIndex, sessionId: string, label: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("assignment_set", { corner, sessionId, label });
}

/** "Clear all": forget the saved assignments and stop reading every registered session. */
export async function clearAssignments(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("assignments_clear");
  await invoke("unregister_all_sessions");
}
