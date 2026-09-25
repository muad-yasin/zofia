import { GridShell } from "./lib/layout/GridShell.js";
import { PaneRegistry } from "./lib/layout/paneRegistry.js";
import { SAMPLE_DETECTED, SAMPLE_SESSIONS } from "./lib/layout/sampleData.js";
import { mountCenterSeat } from "./lib/center/centerSeat.js";
import { isTauriRuntime, listDetectedSessions, listenForLiveSnapshots, registerLiveSession } from "./lib/reader/liveWiring.js";
import { clearAssignments, loadAssignments, saveAssignment } from "./lib/reader/assignments.js";
import type { CornerIndex } from "./lib/layout/types.js";

const registry = new PaneRegistry();

if (!isTauriRuntime()) {
  // Dev-server preview and the Playwright e2e suite (test/e2e/) run outside any real
  // Tauri webview, so there's no backend to wire to — item 2's sample-data shell,
  // unchanged. Corner 3 is left unregistered on purpose, to exercise the "no session
  // assigned" placeholder path PLAN.md §4 requires (never a re-flow that hides an empty
  // slot).
  registry.registerToCorner(0, { sessionId: SAMPLE_SESSIONS[0].session_id, label: "sample-1 (this repo)", snapshot: SAMPLE_SESSIONS[0] });
  registry.registerToCorner(1, { sessionId: SAMPLE_SESSIONS[1].session_id, label: "sample-2 (webshop)", snapshot: SAMPLE_SESSIONS[1] });
  registry.registerToCorner(2, { sessionId: SAMPLE_SESSIONS[2].session_id, label: "sample-3 (idle)", snapshot: SAMPLE_SESSIONS[2] });
}
// Running for real: all four corners start empty. Registration is explicit, never
// automatic discovery (PLAN.md §2.1) — the owner picks a detected session (or pastes an
// id) for each corner in the control GridShell renders for an empty slot.

const root = document.getElementById("app");
if (!root) throw new Error("#app root element missing from index.html");

let shell: GridShell;
const onAssignSession = (corner: CornerIndex, sessionId: string, label: string) => {
  registry.registerToCorner(corner, { sessionId, label, snapshot: null });
  shell.refresh();
  void registerLiveSession(sessionId);
  saveAssignment(corner, sessionId, label).catch(reportWiringError("Saving the corner assignment"));
};

// Option B: forget every saved assignment and stop reading those sessions.
const onClearAll = () => {
  registry.clearAll();
  shell.refresh();
  clearAssignments().catch(reportWiringError("Clearing the corner assignments"));
};

shell = new GridShell(root, registry, onAssignSession, isTauriRuntime() ? onClearAll : undefined);
// A rejected wiring call (e.g. the capability ACL refusing `listen`) must be visible, not
// swallowed: before audit #1 the corners silently sat at "no snapshot yet" forever.
function reportWiringError(what: string) {
  return (err: unknown) => {
    console.error(`[zofia] ${what} failed`, err);
    const banner = document.createElement("p");
    banner.className = "wiring-error";
    banner.setAttribute("role", "alert");
    banner.textContent = `${what} failed: ${String(err)}`;
    root!.prepend(banner);
  };
}

// Restore this boot's saved assignments (option B) only once the snapshot listener is
// attached, so the snapshot register_session emits right away isn't missed.
async function restoreAssignments(): Promise<void> {
  for (const a of await loadAssignments()) {
    registry.registerToCorner(a.corner, { sessionId: a.session_id, label: a.label, snapshot: null, restored: true });
    await registerLiveSession(a.session_id);
  }
  shell.refresh();
}

// The empty corners' picker (quality check Q3): the sessions the shim has seen, refreshed
// every 5 s while any corner is empty. Sample sessions outside Tauri.
if (isTauriRuntime()) {
  const refreshDetected = () => {
    if (registry.getCorners().every((c) => c !== null)) return;
    listDetectedSessions().then((list) => shell.setDetected(list)).catch((err) => console.error("[zofia] listing sessions failed", err));
  };
  refreshDetected();
  setInterval(refreshDetected, 5000);
  window.addEventListener("focus", refreshDetected);
} else {
  shell.setDetected(SAMPLE_DETECTED);
}

listenForLiveSnapshots(registry, shell)
  .then(() => restoreAssignments().catch(reportWiringError("Restoring corner assignments")))
  .catch(reportWiringError("Live snapshot wiring"));
const centerBody = root.querySelector<HTMLElement>("#center-pane .center-body");
if (centerBody) mountCenterSeat(centerBody).catch(reportWiringError("Center seat wiring"));
