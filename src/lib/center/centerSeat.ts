// HANDOFF.md item 4, PLAN.md §3: the center seat's terminal, rendered with xterm.js and
// wired to src-tauri/src/center_seat.rs over Tauri's own IPC. Every keystroke goes out
// tagged with the center seat's session_id; the Rust core rejects any other id, so this
// file is not the ownership boundary, only a client of it.
//
// Scrollback lives in xterm's in-memory buffer only. Nothing here writes it anywhere.
// Outside a Tauri webview (dev preview, Playwright e2e) the item 2 placeholder stays.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { isTauriRuntime } from "../reader/liveWiring.js";

const CENTER_SEAT_SESSION_ID = "center-seat"; // mirrors pty_seat::CENTER_SEAT_SESSION_ID
const RESWEEP_MS = 5000;

interface ForeignSettingsInfo {
  settings_json: string | null;
  settings_local_json: string | null;
  mcp_json: string | null;
  /** Rust's hash of exactly what the dialog shows; the launch must carry it back. */
  digest: string;
}

export async function mountCenterSeat(body: HTMLElement): Promise<void> {
  if (!isTauriRuntime()) return;
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  body.textContent = "";
  body.classList.add("center-live");

  const launcher = document.createElement("form");
  launcher.className = "center-launcher";
  const dirLabel = document.createElement("label");
  dirLabel.textContent = "Working directory ";
  const dirInput = document.createElement("input");
  dirInput.type = "text";
  dirInput.required = true;
  dirInput.placeholder = "/home/…/project";
  dirLabel.append(dirInput);
  const launchBtn = document.createElement("button");
  launchBtn.type = "submit";
  launchBtn.textContent = "Launch";
  launcher.append(dirLabel, launchBtn);

  const modelLine = document.createElement("p");
  modelLine.className = "center-model";

  const notice = document.createElement("p");
  notice.className = "center-notice";
  notice.setAttribute("role", "status");

  const termHost = document.createElement("div");
  termHost.className = "center-term";

  body.append(launcher, modelLine, notice, termHost);

  const term = new Terminal({ convertEol: false, cursorBlink: true, scrollback: 5000 });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(termHost);
  fit.fit();

  let running = false;
  const encoder = new TextEncoder();

  term.onData((data) => {
    if (!running) return;
    void invoke("center_write", { sessionId: CENTER_SEAT_SESSION_ID, data: Array.from(encoder.encode(data)) });
  });
  term.onResize(({ rows, cols }) => {
    if (!running) return;
    void invoke("center_resize", { sessionId: CENTER_SEAT_SESSION_ID, rows, cols });
  });
  new ResizeObserver(() => fit.fit()).observe(termHost);

  // Q12: each launch gets its own output channel; Rust sends raw bytes on it, in order.
  let bytesIn = 0;
  const outputChannel = () => {
    const ch = new Channel<ArrayBuffer | number[]>();
    ch.onmessage = (chunk) => {
      const bytes = new Uint8Array(chunk); // ArrayBuffer, or a number array for small chunks
      bytesIn += bytes.length;
      termHost.dataset.bytesIn = String(bytesIn); // byte count only, never content: lets the smoke test tell "no events" from "not rendered"
      term.write(bytes);
    };
    return ch;
  };
  // Rust frees the seat's slot before emitting this, so Launch works again at once. It says
  // how the seat ended, and the model line goes: nothing is running any more (Q11).
  await listen<{ how: string | null } | null>("zofia://center-exit", (e) => {
    running = false;
    launcher.hidden = false;
    modelLine.textContent = "";
    notice.textContent = `Center seat ${e.payload?.how ?? "exited"}.`;
  });

  // Q11: if the gate would refuse, say so now rather than after Launch.
  const gate = await invoke<string | null>("center_gate");
  if (gate) {
    notice.textContent = gate;
    launchBtn.disabled = true;
  }

  setInterval(async () => {
    if (!running) return;
    const changed = await invoke<string[]>("center_resweep");
    if (changed.length > 0) {
      notice.textContent = `Warning: changed since launch in the seat's directory: ${changed.join(", ")}`;
      notice.classList.add("center-warning");
    }
  }, RESWEEP_MS);

  // confirmedDigest: null when preflight found no foreign settings, else the digest of the
  // files the owner just saw. Rust refuses if they changed since.
  const spawn = async (workdir: string, confirmedDigest: string | null) => {
    try {
      // No model picker yet: null means config/providers.json's default (owner decision 4,
      // sonnet), applied in Rust. The pane shows the model and effort Rust read back from
      // the argv it actually launched (effort: owner decision 2).
      const launched = await invoke<{ model: string; effort: string | null }>("center_spawn", { workdir, confirmedDigest, model: null, onOutput: outputChannel() });
      running = true;
      launcher.hidden = true;
      modelLine.textContent = `Model: ${launched.model}` + (launched.effort ? ` · effort: ${launched.effort}` : "");
      notice.textContent = "";
      notice.classList.remove("center-warning");
      await invoke("center_resize", { sessionId: CENTER_SEAT_SESSION_ID, rows: term.rows, cols: term.cols });
      term.focus();
    } catch (err) {
      notice.textContent = String(err);
    }
  };

  launcher.addEventListener("submit", async (e) => {
    e.preventDefault();
    const workdir = dirInput.value.trim();
    const foreign = await invoke<ForeignSettingsInfo | null>("center_preflight", { workdir });
    if (!foreign) {
      await spawn(workdir, null);
      return;
    }
    showForeignSettingsDialog(body, foreign, () => void spawn(workdir, foreign.digest));
  });
}

/** PLAN.md §3: show the directory's own settings and wait for an explicit confirm. In-DOM,
 * never window.confirm. File contents go in as text, never as HTML. */
function showForeignSettingsDialog(host: HTMLElement, info: ForeignSettingsInfo, onConfirm: () => void): void {
  const dialog = document.createElement("div");
  dialog.className = "center-confirm";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-label", "Confirm project settings before launch");

  const intro = document.createElement("p");
  intro.textContent =
    "This folder has its own Claude Code settings. The center seat launches with --restricted, which Claude Code documents as ignoring them, and with no MCP servers, so they should not widen its policy; item 8's probe hasn't measured that yet. Review them before launching.";
  dialog.append(intro);

  for (const [name, text] of [
    [".claude/settings.json", info.settings_json],
    [".claude/settings.local.json", info.settings_local_json],
    [".mcp.json", info.mcp_json],
  ] as const) {
    if (text === null) continue;
    const h = document.createElement("h3");
    h.textContent = name;
    const pre = document.createElement("pre");
    pre.textContent = text;
    dialog.append(h, pre);
  }

  const confirm = document.createElement("button");
  confirm.textContent = "Launch with these settings";
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  confirm.addEventListener("click", () => {
    dialog.remove();
    onConfirm();
  });
  cancel.addEventListener("click", () => dialog.remove());
  dialog.append(confirm, cancel);
  host.append(dialog);
  cancel.focus();
}
