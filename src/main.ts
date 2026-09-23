import { GridShell } from "./lib/layout/GridShell.js";
import { PaneRegistry } from "./lib/layout/paneRegistry.js";
import { SAMPLE_SESSIONS } from "./lib/layout/sampleData.js";
import { mountCenterSeat } from "./lib/center/centerSeat.js";
import { isTauriRuntime, listenForLiveSnapshots, registerLiveSession } from "./lib/reader/liveWiring.js";
import type { CornerIndex } from "./lib/layout/types.js";

const registry = new PaneRegistry();

if (!isTauriRuntime()) {
  // Dev-server preview and the Playwright e2e suite (test/e2e/) run outside any real
  // Tauri webview, so there's no backend to wire to — item 2's sample-data shell,
  // unchanged. Corner 3 is left unregistered on purpose, to exercise the "no session
  // assigned" placeholder path PLAN.md §4 requires (never a re-flow that hides an empty
  // slot).
  registry.registerToCorner(0, { sessionId: SAMPLE_SESSIONS[0].session_id, label: "sample-1 (this repo)", snapshot: SAMPLE_SESSIONS[0] });
  registry.registerToCorner(1, { sessionId: SAMPLE_SESSIONS[1].session_id, label: "sample-2 (SMO)", snapshot: SAMPLE_SESSIONS[1] });
  registry.registerToCorner(2, { sessionId: SAMPLE_SESSIONS[2].session_id, label: "sample-3 (idle)", snapshot: SAMPLE_SESSIONS[2] });
}
// Running for real: all four corners start empty. Registration is explicit, never
// automatic discovery (PLAN.md §2.1) — the owner assigns a real session_id to each
// corner by hand via the "Assign" control GridShell renders for an empty slot.

const root = document.getElementById("app");
if (!root) throw new Error("#app root element missing from index.html");

let shell: GridShell;
const onAssignSession = (corner: CornerIndex, sessionId: string) => {
  registry.registerToCorner(corner, { sessionId, label: sessionId, snapshot: null });
  shell.refresh();
  void registerLiveSession(sessionId);
};

shell = new GridShell(root, registry, onAssignSession);
// A rejected wiring call (e.g. the capability ACL refusing `listen`) must be visible, not
// swallowed: before audit #1 the corners silently sat at "no snapshot yet" forever.
const reportWiringError = (what: string) => (err: unknown) => {
  console.error(`[zofia] ${what} failed`, err);
  const banner = document.createElement("p");
  banner.className = "wiring-error";
  banner.setAttribute("role", "alert");
  banner.textContent = `${what} failed: ${String(err)}`;
  root.prepend(banner);
};
listenForLiveSnapshots(registry, shell).catch(reportWiringError("Live snapshot wiring"));
const centerBody = root.querySelector<HTMLElement>("#center-pane .center-body");
if (centerBody) mountCenterSeat(centerBody).catch(reportWiringError("Center seat wiring"));
