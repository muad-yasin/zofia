import type { CornerIndex, Field, RegisteredSession } from "./types.js";
import type { PaneRegistry } from "./paneRegistry.js";

const BREAKPOINT_FULL = 1280;
const BREAKPOINT_MEDIUM = 900;
const PANE_FLOOR_WIDTH = 480;
const PANE_FLOOR_HEIGHT = 320;
const ARIA_LIVE_THROTTLE_MS = 2000; // PLAN.md §4: max 1 announcement per 2s

type Breakpoint = "full" | "medium" | "compact";

function windowSizeFor(bp: Breakpoint): number {
  if (bp === "full") return 4;
  if (bp === "medium") return 2;
  return 1;
}

function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINT_FULL) return "full";
  if (width >= BREAKPOINT_MEDIUM) return "medium";
  return "compact";
}

function fmtAvailability(a: Field<unknown>["availability"]): string {
  return a === "exposed" ? "measured" : a === "approximable" ? "approx." : "UNKNOWN";
}

function fmtPct(f: Field<number>): string {
  if (f.availability === "unknown" || f.value === null) return "—";
  return `${f.value.toFixed(0)}%`;
}

/** Unix epoch seconds -> local wall-clock time. Absolute on purpose: a relative "Ns ago"
 * would go stale between re-renders and read as a measurement it no longer is. */
function fmtClock(f: Field<number>): string {
  if (f.availability === "unknown" || f.value === null) return "—";
  return new Date(f.value * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Renders the fixed top-bar + four-corner + center shell (PLAN.md §4) into `root`.
 * Corner panes render `SessionSnapshot` state cards only — never terminal bytes; a GUI
 * process cannot attach a read-only PTY to a foreign hand-opened terminal on Linux
 * (PLAN.md §4's own confirmed architectural fact, not a design choice this class could
 * reconsider).
 */
export class GridShell {
  private root: HTMLElement;
  private registry: PaneRegistry;
  private shellEl!: HTMLElement;
  private cornerGridEl!: HTMLElement;
  private tabStripEl!: HTMLElement;
  private centerEl!: HTMLElement;
  private liveRegionEl!: HTMLElement;

  private breakpoint: Breakpoint;
  private windowStart = 0;
  private lastAnnounceAt = 0;
  private resizeObserver: ResizeObserver;
  private centerMinimized = false;
  private centerDrag: { dx: number; dy: number } | null = null;

  private clearAllBtn: HTMLButtonElement | null = null;

  constructor(
    root: HTMLElement,
    registry: PaneRegistry,
    private onAssignSession?: (corner: CornerIndex, sessionId: string) => void,
    private onClearAll?: () => void,
  ) {
    this.root = root;
    this.registry = registry;
    this.breakpoint = breakpointFor(window.innerWidth);
    this.resizeObserver = new ResizeObserver((entries) => this.onCornerResize(entries));
    this.buildDom();
    window.addEventListener("resize", () => this.onViewportResize());
  }

  private buildDom(): void {
    this.root.innerHTML = "";

    const topbar = document.createElement("header");
    topbar.id = "topbar";
    topbar.setAttribute("role", "banner");
    const h1 = document.createElement("h1");
    h1.textContent = "Zofia";
    const spacer = document.createElement("div");
    spacer.style.flex = "1 1 auto";
    const minimizeBtn = document.createElement("button");
    minimizeBtn.type = "button";
    minimizeBtn.textContent = "Toggle center seat";
    minimizeBtn.addEventListener("click", () => this.toggleCenterMinimized());
    topbar.append(h1, spacer);
    // Option B (DECISIONS.md, 2026-09-23): assignments come back after a restart, so there
    // is a one-click way to forget them all.
    if (this.onClearAll) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "clear-all";
      clearBtn.textContent = "Clear all corners";
      clearBtn.addEventListener("click", () => this.onClearAll?.());
      this.clearAllBtn = clearBtn;
      topbar.append(clearBtn);
    }
    topbar.append(minimizeBtn);

    const shell = document.createElement("main");
    shell.id = "shell";
    this.shellEl = shell;

    const cornerGrid = document.createElement("div");
    cornerGrid.id = "corner-grid";
    this.cornerGridEl = cornerGrid;

    const tabStrip = document.createElement("div");
    tabStrip.id = "tab-strip";
    tabStrip.setAttribute("role", "tablist");
    tabStrip.setAttribute("aria-label", "Registered sessions");
    tabStrip.hidden = true;
    this.tabStripEl = tabStrip;

    const center = document.createElement("section");
    center.id = "center-pane";
    center.tabIndex = 0;
    center.setAttribute("aria-label", "C&C center seat");
    this.centerEl = center;
    this.buildCenterPane();

    shell.append(cornerGrid, tabStrip, center);

    const live = document.createElement("div");
    live.id = "aria-live";
    live.className = "sr-only";
    live.setAttribute("aria-live", "polite");
    this.liveRegionEl = live;

    this.root.append(topbar, shell, live);
    this.render();
  }

  private buildCenterPane(): void {
    const header = document.createElement("div");
    header.className = "center-header";
    const h2 = document.createElement("h2");
    h2.textContent = "C&C — center seat";
    header.append(h2);
    header.addEventListener("pointerdown", (e) => this.onDragStart(e));

    const body = document.createElement("div");
    body.className = "center-body";
    body.textContent = "Center seat placeholder (item 4 wires the real PTY).";

    this.centerEl.append(header, body);
    window.addEventListener("pointermove", (e) => this.onDragMove(e));
    window.addEventListener("pointerup", () => (this.centerDrag = null));
  }

  private onDragStart(e: PointerEvent): void {
    const rect = this.centerEl.getBoundingClientRect();
    this.centerDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
  }

  private onDragMove(e: PointerEvent): void {
    if (!this.centerDrag) return;
    const { dx, dy } = this.centerDrag;
    this.centerEl.style.left = `${e.clientX - dx}px`;
    this.centerEl.style.top = `${e.clientY - dy}px`;
    this.centerEl.style.transform = "none";
  }

  private toggleCenterMinimized(): void {
    this.centerMinimized = !this.centerMinimized;
    this.centerEl.classList.toggle("minimized", this.centerMinimized);
    this.announce(this.centerMinimized ? "Center seat minimized" : "Center seat restored");
  }

  /** Re-renders against the registry's current state — call after `updateSnapshot`
   * (item 3: real reader data arriving async via the Tauri event bridge). Public because
   * the caller that owns the data feed lives outside this class (PLAN.md §2 and §4 don't
   * cross-reference each other's data; this is the one deliberate seam between them). */
  refresh(): void {
    this.render();
  }

  private onViewportResize(): void {
    const next = breakpointFor(window.innerWidth);
    if (next !== this.breakpoint) {
      this.breakpoint = next;
      this.windowStart = 0;
      this.render();
    }
  }

  private onCornerResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      // The 480x320 pane floor describes the pane's visible (border) box, not its
      // content box — contentRect excludes padding, which undercounted by 2 * 1rem and
      // tripped the floor on panes that were visibly well above it.
      const box = entry.borderBoxSize[0];
      el.dataset.compact = String(box.inlineSize < PANE_FLOOR_WIDTH || box.blockSize < PANE_FLOOR_HEIGHT);
    }
  }

  /** Total conceptual tab entries: the four fixed corner slots (placeholders included)
   * plus any fifth-and-later overflow session (PLAN.md §4). */
  private allEntries(): (RegisteredSession | null)[] {
    return [...this.registry.getCorners(), ...this.registry.getOverflow()];
  }

  private render(): void {
    const entries = this.allEntries();
    const windowSize = Math.min(windowSizeFor(this.breakpoint), entries.length || windowSizeFor(this.breakpoint));
    const total = entries.length;
    const showTabStrip = windowSize < total;

    this.windowStart = Math.max(0, Math.min(this.windowStart, Math.max(0, total - windowSize)));
    // Corners always occupy entries[0..4) (allEntries() puts them before overflow), so an
    // absolute index under 4 IS the real corner slot regardless of tab-strip windowing —
    // needed to route an empty-slot assignment (below) to the right registry slot even
    // when the visible window doesn't start at 0.
    const startIndex = showTabStrip ? this.windowStart : 0;
    const visibleEntries = showTabStrip ? entries.slice(this.windowStart, this.windowStart + windowSize) : entries.slice(0, 4);
    const visible = visibleEntries.map((session, i) => {
      const absolute = startIndex + i;
      return { session, cornerIndex: (absolute < 4 ? absolute : null) as CornerIndex | null };
    });

    this.shellEl.dataset.windowSize = String(showTabStrip ? windowSize : 4);
    this.tabStripEl.hidden = !showTabStrip;

    if (this.clearAllBtn) this.clearAllBtn.disabled = this.registry.getAllTabEntries().length === 0;
    this.renderCorners(visible);
    if (showTabStrip) this.renderTabStrip(entries);
  }

  private renderCorners(visible: { session: RegisteredSession | null; cornerIndex: CornerIndex | null }[]): void {
    // Snapshot events re-render every corner, so carry over what the owner is in the
    // middle of: text typed into an assign box, and which corner element had focus
    // (audit F5, 2026-09-23 — each statusline update used to wipe both).
    const typed = new Map<string, { value: string; start: number | null; end: number | null }>();
    this.cornerGridEl.querySelectorAll<HTMLInputElement>(".assign-form input").forEach((input) => {
      if (input.dataset.slot) typed.set(input.dataset.slot, { value: input.value, start: input.selectionStart, end: input.selectionEnd });
    });
    const active = document.activeElement as HTMLElement | null;
    const focusedCorner = active && this.cornerGridEl.contains(active) ? active.closest<HTMLElement>(".corner")?.dataset.corner : undefined;
    const focusedRole = active?.tagName === "INPUT" ? "input" : active?.tagName === "BUTTON" ? "button" : "corner";

    this.resizeObserver.disconnect();
    this.cornerGridEl.innerHTML = "";
    visible.forEach(({ session, cornerIndex }, i) => {
      const el = document.createElement("section");
      el.className = "corner" + (session ? "" : " empty");
      el.tabIndex = 0;
      el.dataset.corner = String(i);
      // Which side the center seat overlaps: a left-column corner's inner edge is its right.
      el.dataset.side = i % 2 === 0 ? "left" : "right";
      el.dataset.row = visible.length === 4 && i >= 2 ? "bottom" : "top";
      el.setAttribute("aria-label", session ? `Session: ${session.label}` : `Corner ${i + 1}: no session assigned`);

      if (!session) {
        el.append(this.buildAssignForm(cornerIndex));
      } else {
        el.append(this.buildFullCard(session), this.buildCompactCard(session));
      }

      this.cornerGridEl.append(el);
      this.resizeObserver.observe(el, { box: "border-box" });

      const input = el.querySelector<HTMLInputElement>(".assign-form input");
      const kept = input?.dataset.slot ? typed.get(input.dataset.slot) : undefined;
      if (input && kept) {
        input.value = kept.value;
        if (kept.start !== null) input.setSelectionRange(kept.start, kept.end ?? kept.start);
      }
      if (focusedCorner === String(i)) {
        const target = focusedRole === "input" ? input : focusedRole === "button" ? el.querySelector<HTMLElement>(".assign-form button") : el;
        (target ?? el).focus({ preventScroll: true });
      }
    });
  }

  /** Registration is explicit, never automatic discovery (PLAN.md §2.1) — this is the
   * owner's own "assign a detected session_id to each corner pane by hand" action, not a
   * scanned/auto-filled list. No-op if the shell was built without an assign callback
   * (dev-server preview, e2e tests) — the corner just stays "no session assigned". */
  private buildAssignForm(cornerIndex: CornerIndex | null): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "assign-form";
    const label = document.createElement("p");
    label.textContent = "no session assigned";
    wrap.append(label);

    if (cornerIndex === null || !this.onAssignSession) return wrap;

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "session_id";
    input.setAttribute("aria-label", `Assign a session to corner ${cornerIndex + 1}`);
    input.dataset.slot = String(cornerIndex);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Assign";

    const submit = () => {
      const sessionId = input.value.trim();
      if (!sessionId) return;
      this.onAssignSession?.(cornerIndex, sessionId);
    };
    button.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    wrap.append(input, button);
    return wrap;
  }

  private buildFullCard(session: RegisteredSession): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "full-card";
    const h2 = document.createElement("h2");
    h2.textContent = session.label;
    if (session.restored) {
      const tag = document.createElement("span");
      tag.className = "restored-chip";
      tag.textContent = "restored";
      tag.title = "Assigned earlier this boot and restored at launch; Clear all corners forgets it";
      h2.append(" ", tag);
    }
    wrap.append(h2);

    const snap = session.snapshot;
    if (!snap) {
      wrap.append(this.fieldRow("status", "no snapshot yet", "unknown"));
      return wrap;
    }

    wrap.append(
      this.fieldRow("model", snap.model.value?.display_name ?? "—", snap.model.availability),
      this.fieldRow("effort", snap.effort.value ?? "—", snap.effort.availability),
      this.fieldRow("usage", fmtPct(snap.usagePercent), snap.usagePercent.availability),
      this.fieldRow("resets", fmtClock(snap.resetTimer), snap.resetTimer.availability),
      this.fieldRow("context", fmtPct(snap.contextPercent), snap.contextPercent.availability),
      this.fieldRow("activity", snap.activityState.value ?? "—", snap.activityState.availability),
      this.fieldRow("last active", fmtClock(snap.lastActiveTime), snap.lastActiveTime.availability),
      this.fieldRow("duration", snap.durationLine.value ?? "—", snap.durationLine.availability),
      this.fieldRow("spend", snap.tokenSpend.usd.value != null ? `$${snap.tokenSpend.usd.value.toFixed(2)}` : "—", snap.tokenSpend.usd.availability)
    );
    return wrap;
  }

  private buildCompactCard(session: RegisteredSession): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "compact-card";
    const snap = session.snapshot;
    const modelName = snap?.model.value?.display_name ?? "—";
    const availability = snap?.model.availability ?? "unknown";
    wrap.append(document.createTextNode(`${session.label}: ${modelName}`), this.chip(availability));
    return wrap;
  }

  private fieldRow(label: string, value: string, availability: Field<unknown>["availability"]): HTMLElement {
    const row = document.createElement("div");
    row.className = "field-row";
    const labelEl = document.createElement("span");
    labelEl.className = "label";
    labelEl.textContent = label;
    const valueWrap = document.createElement("span");
    valueWrap.append(document.createTextNode(value + " "), this.chip(availability));
    row.append(labelEl, valueWrap);
    return row;
  }

  private chip(availability: Field<unknown>["availability"]): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "availability-chip";
    chip.dataset.availability = availability;
    chip.textContent = fmtAvailability(availability);
    return chip;
  }

  private renderTabStrip(entries: (RegisteredSession | null)[]): void {
    this.tabStripEl.innerHTML = "";
    entries.forEach((session, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      const selected = i >= this.windowStart && i < this.windowStart + Math.max(1, windowSizeFor(this.breakpoint));
      btn.setAttribute("aria-selected", String(selected));
      btn.tabIndex = selected ? 0 : -1;
      btn.textContent = session ? session.label : `Corner ${Math.min(i + 1, 4)} (empty)`;
      btn.addEventListener("click", () => this.selectTab(i));
      btn.addEventListener("keydown", (e) => this.onTabKeydown(e, i, entries.length));
      this.tabStripEl.append(btn);
    });
  }

  private onTabKeydown(e: KeyboardEvent, index: number, total: number): void {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? Math.min(index + 1, total - 1) : Math.max(index - 1, 0);
    this.selectTab(next);
    (this.tabStripEl.children[next] as HTMLElement)?.focus();
  }

  private selectTab(index: number): void {
    const windowSize = windowSizeFor(this.breakpoint);
    if (index < this.windowStart) this.windowStart = index;
    else if (index >= this.windowStart + windowSize) this.windowStart = index - windowSize + 1;
    this.render();
    const label = this.allEntries()[index]?.label ?? `corner ${index + 1}`;
    this.announce(`Now showing ${label}`);
  }

  private announce(message: string): void {
    const now = Date.now();
    if (now - this.lastAnnounceAt < ARIA_LIVE_THROTTLE_MS) return;
    this.lastAnnounceAt = now;
    this.liveRegionEl.textContent = message;
  }
}
