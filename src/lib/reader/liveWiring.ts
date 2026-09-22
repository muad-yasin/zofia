// Item 3 (HANDOFF.md, PLAN.md §2): wires the observation bridge's real per-session data
// into already-built corner panes over Tauri's own authenticated event transport
// (PLAN.md §2.1's "existing authenticated frontend transport" — the webview can only
// reach its own app's backend, not an arbitrary origin). No-op outside an actual Tauri
// webview (dev-server preview, Playwright e2e) — those keep rendering sampleData.ts
// exactly as item 2 shipped it, since there's no backend to invoke.

import type { GridShell } from "../layout/GridShell.js";
import type { PaneRegistry } from "../layout/paneRegistry.js";
import type { SessionSnapshot } from "../layout/types.js";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface SnapshotEventPayload {
  session_id: string;
  snapshot: SessionSnapshot;
}

/** Registers one session_id with the Rust backend (src-tauri/src/watcher.rs) so its
 * file-change events start producing snapshots for it — the owner's own explicit
 * assignment, never auto-discovery (PLAN.md §2.1). No-op outside Tauri. */
export async function registerLiveSession(sessionId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("register_session", { sessionId });
}

/** Subscribes once to the backend's snapshot event, routing each one into the registry
 * and re-rendering the shell. Call once per shell instance; safe to call in a non-Tauri
 * context (resolves immediately, no listener attached). */
export async function listenForLiveSnapshots(registry: PaneRegistry, shell: GridShell): Promise<void> {
  if (!isTauriRuntime()) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<SnapshotEventPayload>("zofia://snapshot", (event) => {
    registry.updateSnapshot(event.payload.session_id, event.payload.snapshot);
    shell.refresh();
  });
}
