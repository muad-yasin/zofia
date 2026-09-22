import { GridShell } from "./lib/layout/GridShell.js";
import { PaneRegistry } from "./lib/layout/paneRegistry.js";
import { SAMPLE_SESSIONS } from "./lib/layout/sampleData.js";

// Week 1, Track B (HANDOFF.md item 2): sample data only, no reader wiring yet.
// Corner 3 is left unregistered on purpose, to exercise the "no session assigned"
// placeholder path PLAN.md §4 requires (never a re-flow that hides an empty slot).
const registry = new PaneRegistry();
registry.registerToCorner(0, { sessionId: SAMPLE_SESSIONS[0].session_id, label: "sample-1 (this repo)", snapshot: SAMPLE_SESSIONS[0] });
registry.registerToCorner(1, { sessionId: SAMPLE_SESSIONS[1].session_id, label: "sample-2 (SMO)", snapshot: SAMPLE_SESSIONS[1] });
registry.registerToCorner(2, { sessionId: SAMPLE_SESSIONS[2].session_id, label: "sample-3 (idle)", snapshot: SAMPLE_SESSIONS[2] });

const root = document.getElementById("app");
if (!root) throw new Error("#app root element missing from index.html");
new GridShell(root, registry);
