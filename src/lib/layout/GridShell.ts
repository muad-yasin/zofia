import type { CornerIndex, DetectedSession, RegisteredSession } from "./types.js";
import { buildCompactCard, buildFullCard, fmtAbsolute, fmtRelative, refreshRelativeTimes } from "./cardView.js";
import type { PaneRegistry } from "./paneRegistry.js";

const PANE_FLOOR_WIDTH = 480;
const PANE_FLOOR_HEIGHT = 320;
const GRID_GAP_PX = 12; // #corner-grid's gap and padding, 0.75rem at the default 16 px root
// Quality check Q7 (2026-09-24): the full 2x2 grid shows as soon as two corners fit side by
// side at the pane floor (2 x 480 + 3 gaps = 996 px), not from a fixed 1280, which dropped
// two corners that would fit. Both numbers stay placeholders until the owner measures his
// screen (PLAN.md §10 decision 3); this only ties the breakpoint to the floor.
const BREAKPOINT_FULL = 2 * PANE_FLOOR_WIDTH + 3 * GRID_GAP_PX;
const BREAKPOINT_MEDIUM = 900;
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

/** How often relative times ("40s ago", "in 3h 12m") are re-rendered in place. */
const RELATIVE_TICK_MS = 5000;

/** Replaces each direct child of `oldEl` whose markup changed, leaving the rest untouched
 * (quality check Q8: a snapshot used to rebuild all four corners, losing scroll, text
 * selection and the compact state). Falls back to replacing `oldEl` when the shape differs. */
function patchChildren(oldEl: Element, newEl: Element): void {
  const olds = Array.from(oldEl.children);
  const news = Array.from(newEl.children);
  if (olds.length !== news.length || olds.some((o, k) => o.tagName !== news[k].tagName || o.className !== news[k].className)) {
    oldEl.replaceWith(newEl);
    return;
  }
  olds.forEach((o, k) => {
    if (o.outerHTML !== news[k].outerHTML) o.replaceWith(news[k]);
  });
}

/** The name a picked session gets in its corner: its folder, plus the id's first four
 * characters when another offered session shares the folder. */
export function pickerLabel(session: DetectedSession, offered: DetectedSession[]): string {
  const shared = offered.filter((d) => d.project === session.project).length > 1;
  return shared ? `${session.project} · ${session.session_id.slice(0, 4)}` : session.project;
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
  private centerBtn!: HTMLButtonElement;
  private accountEl!: HTMLElement;
  /** Sessions the shim has seen, offered in every empty corner (quality check Q3). */
  private detected: DetectedSession[] = [];

  constructor(
    root: HTMLElement,
    registry: PaneRegistry,
    private onAssignSession?: (corner: CornerIndex, sessionId: string, label: string) => void,
    private onClearAll?: () => void,
  ) {
    this.root = root;
    this.registry = registry;
    this.breakpoint = breakpointFor(window.innerWidth);
    this.resizeObserver = new ResizeObserver((entries) => this.onCornerResize(entries));
    this.buildDom();
    window.addEventListener("resize", () => this.onViewportResize());
    setInterval(() => {
      refreshRelativeTimes(this.cornerGridEl);
      this.renderAccount();
    }, RELATIVE_TICK_MS);
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
    minimizeBtn.className = "center-toggle";
    minimizeBtn.textContent = "Hide C&C";
    minimizeBtn.setAttribute("aria-pressed", "false");
    minimizeBtn.addEventListener("click", () => this.toggleCenterMinimized());
    this.centerBtn = minimizeBtn;
    // Q6: the subscription's five-hour usage and reset belong to the account, not to a
    // corner, so the top bar shows them once, with the time.
    const account = document.createElement("div");
    account.id = "account";
    account.setAttribute("aria-label", "Subscription usage and time");
    this.accountEl = account;
    topbar.append(h1, account, spacer);
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
    shell.dataset.center = "open";
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
    this.centerBtn.textContent = this.centerMinimized ? "Show C&C" : "Hide C&C";
    this.centerBtn.setAttribute("aria-pressed", String(this.centerMinimized));
    this.shellEl.dataset.center = this.centerMinimized ? "minimized" : "open";
    this.announce(this.centerMinimized ? "Center seat minimized" : "Center seat restored");
  }

  /** Re-renders against the registry's current state — call after `updateSnapshot`
   * (item 3: real reader data arriving async via the Tauri event bridge). Public because
   * the caller that owns the data feed lives outside this class (PLAN.md §2 and §4 don't
   * cross-reference each other's data; this is the one deliberate seam between them). */
  refresh(): void {
    this.render();
  }

  /** New picker contents (main.ts polls the backend). Re-renders only when something an
   * empty corner shows would change, so a steady list never disturbs typing or focus. */
  setDetected(list: DetectedSession[]): void {
    const key = (l: DetectedSession[]) => JSON.stringify(l.map((d) => [d.session_id, d.project, d.activity, d.last_active]));
    if (key(list) === key(this.detected)) return;
    this.detected = list;
    if (this.registry.getCorners().some((c) => c === null)) this.render();
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
    this.renderAccount();
    this.renderCorners(visible);
    if (showTabStrip) this.renderTabStrip(entries);
  }

  private renderCorners(visible: { session: RegisteredSession | null; cornerIndex: CornerIndex | null }[]): void {
    // Keyed update (quality check Q8): a corner showing the same session keeps its element,
    // and only the rows whose content changed are replaced; an unchanged corner is not
    // touched at all. Only a corner that changes what it shows is rebuilt, and for those,
    // carry over what the owner is in the middle of: text typed into an assign box, and
    // which corner element had focus (audit F5, 2026-09-23).
    const typed = new Map<string, { value: string; start: number | null; end: number | null }>();
    this.cornerGridEl.querySelectorAll<HTMLInputElement>(".assign-form input").forEach((input) => {
      if (input.dataset.slot) typed.set(input.dataset.slot, { value: input.value, start: input.selectionStart, end: input.selectionEnd });
    });
    const active = document.activeElement as HTMLElement | null;
    const focusedCorner = active && this.cornerGridEl.contains(active) ? active.closest<HTMLElement>(".corner")?.dataset.corner : undefined;
    const focusedRole = active?.tagName === "INPUT" ? "input" : active?.classList.contains("pick") ? `pick:${active.dataset.sessionId}` : active?.tagName === "BUTTON" ? "button" : "corner";
    // Only a paste box the owner opened or closed by hand keeps its state; one still at its
    // default follows the new default (open exactly when no session is offered).
    const pasteToggled = new Map<string, boolean>();
    this.cornerGridEl.querySelectorAll<HTMLDetailsElement>(".assign-form details").forEach((d) => {
      if (d.dataset.slot && String(d.open) !== d.dataset.defaultOpen) pasteToggled.set(d.dataset.slot, d.open);
    });

    const existing = Array.from(this.cornerGridEl.children) as HTMLElement[];
    const pickerSig = JSON.stringify([
      this.detected.map((d) => [d.session_id, d.project, d.activity, d.model, d.last_active]),
      this.registry.getAllTabEntries().map((e) => e.sessionId),
    ]);
    visible.forEach(({ session, cornerIndex }, i) => {
      const key = session ? `s:${session.sessionId}` : `e:${cornerIndex}`;
      const sig = session ? JSON.stringify([session.label, session.restored ?? false, session.snapshot]) : pickerSig;
      const label = session ? `Session: ${session.label}` : `Corner ${i + 1}: no session assigned`;
      const old = existing[i];

      if (old && old.dataset.key === key) {
        this.placeCorner(old, i, visible.length, label);
        if (old.dataset.sig === sig) return;
        if (session) {
          const [full, compact] = old.children;
          patchChildren(full, buildFullCard(session));
          patchChildren(compact, buildCompactCard(session));
          old.dataset.sig = sig;
          return;
        }
      }

      const el = document.createElement("section");
      el.className = "corner" + (session ? "" : " empty");
      el.tabIndex = 0;
      el.dataset.key = key;
      el.dataset.sig = sig;
      this.placeCorner(el, i, visible.length, label);
      if (!session) {
        el.append(this.buildAssignForm(cornerIndex));
      } else {
        el.append(buildFullCard(session), buildCompactCard(session));
      }
      if (old) {
        // Keep the pane-floor state until the observer re-measures, so a compact pane
        // never flashes its full card for a frame.
        if (old.dataset.compact) el.dataset.compact = old.dataset.compact;
        this.resizeObserver.unobserve(old);
        old.replaceWith(el);
      } else {
        this.cornerGridEl.append(el);
      }
      this.resizeObserver.observe(el, { box: "border-box" });

      const input = el.querySelector<HTMLInputElement>(".assign-form input");
      const paste = el.querySelector<HTMLDetailsElement>(".assign-form details");
      const toggled = paste?.dataset.slot ? pasteToggled.get(paste.dataset.slot) : undefined;
      if (paste && toggled !== undefined) paste.open = toggled;
      const kept = input?.dataset.slot ? typed.get(input.dataset.slot) : undefined;
      if (input && kept) {
        input.value = kept.value;
        if (kept.start !== null) input.setSelectionRange(kept.start, kept.end ?? kept.start);
      }
      if (focusedCorner === String(i)) {
        const target = focusedRole === "input" ? input
          : focusedRole.startsWith("pick:") ? el.querySelector<HTMLElement>(`.pick[data-session-id="${CSS.escape(focusedRole.slice(5))}"]`)
          : focusedRole === "button" ? el.querySelector<HTMLElement>(".assign-form .paste button") : el;
        (target ?? el).focus({ preventScroll: true });
      }
    });
    for (const extra of existing.slice(visible.length)) {
      this.resizeObserver.unobserve(extra);
      extra.remove();
    }
  }

  /** Usage and reset from whichever registered session reported them most recently (the
   * corners can disagree: an idle session may no longer carry `five_hour`), plus the clock. */
  private renderAccount(): void {
    const reporting = this.registry
      .getAllTabEntries()
      .filter((e) => e.snapshot !== null && e.snapshot.usagePercent.availability !== "unknown" && e.snapshot.usagePercent.value !== null)
      .sort((a, b) => (b.snapshot!.usagePercent.observed_at ?? 0) - (a.snapshot!.usagePercent.observed_at ?? 0));
    const freshest = reporting[0]?.snapshot;
    const from = reporting[0]?.label;
    const parts: string[] = [];
    let title = "No assigned session has reported the five-hour limit yet.";
    if (freshest) {
      parts.push(`5h usage ${freshest.usagePercent.value!.toFixed(0)}%`);
      const reset = freshest.resetTimer.value;
      if (freshest.resetTimer.availability !== "unknown" && reset !== null) parts.push(`resets ${fmtRelative(reset)}`);
      title = `From ${from}: ${freshest.usagePercent.source}` + (reset !== null ? `; resets ${fmtAbsolute(reset)}` : "");
    } else {
      parts.push("5h usage —");
    }
    parts.push(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    const text = parts.join(" · ");
    if (this.accountEl.textContent !== text) this.accountEl.textContent = text;
    this.accountEl.title = title;
  }

  /** Position-dependent attributes, re-applied whenever a corner element is reused. */
  private placeCorner(el: HTMLElement, i: number, count: number, label: string): void {
    el.dataset.corner = String(i);
    // Which side the center seat overlaps: a left-column corner's inner edge is its right.
    el.dataset.side = i % 2 === 0 ? "left" : "right";
    el.dataset.row = count === 4 && i >= 2 ? "bottom" : "top";
    el.setAttribute("aria-label", label);
  }

  /** Registration is explicit, never automatic discovery (PLAN.md §2.1): the owner picks
   * one of the sessions the shim has seen (quality check Q3: by folder and activity, not by
   * a UUID copied out of `ls`), or pastes an id. Nothing is read continuously until they
   * pick. No-op if the shell was built without an assign callback — the corner just stays
   * "no session assigned". */
  private buildAssignForm(cornerIndex: CornerIndex | null): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "assign-form";
    const label = document.createElement("p");
    label.textContent = "no session assigned";
    wrap.append(label);

    if (cornerIndex === null || !this.onAssignSession) return wrap;

    const taken = new Set(this.registry.getAllTabEntries().map((s) => s.sessionId));
    const offered = this.detected.filter((d) => !taken.has(d.session_id));
    const hint = document.createElement("p");
    hint.className = "picker-hint";
    if (offered.length) {
      hint.textContent = "Pick a session for this corner:";
      const list = document.createElement("ul");
      list.className = "session-picker";
      for (const d of offered) {
        const name = pickerLabel(d, offered);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pick";
        btn.dataset.sessionId = d.session_id;
        btn.title = `${d.cwd ?? "folder not recorded yet"}\n${d.session_id}`;
        const nameEl = document.createElement("span");
        nameEl.className = "pick-name";
        nameEl.textContent = name;
        const detail = document.createElement("span");
        detail.className = "pick-detail";
        detail.textContent = [d.activity, d.model].filter(Boolean).join(" · ");
        if (d.last_active !== null) {
          const when = document.createElement("time");
          when.className = "rel-time";
          when.dataset.epoch = String(d.last_active);
          when.textContent = fmtRelative(d.last_active);
          detail.append(detail.textContent ? " · " : "", when);
        } else {
          detail.append(detail.textContent ? " · " : "", "no activity seen yet");
        }
        btn.append(nameEl, detail);
        btn.setAttribute("aria-label", `Show ${name} in corner ${cornerIndex + 1}: ${detail.textContent}`);
        btn.addEventListener("click", () => this.onAssignSession?.(cornerIndex, d.session_id, name));
        const li = document.createElement("li");
        li.append(btn);
        list.append(li);
      }
      wrap.append(hint, list);
    } else {
      hint.textContent = "No Claude Code session found yet. Start one in a terminal and it shows up here.";
      wrap.append(hint);
    }

    const paste = document.createElement("details");
    paste.className = "paste";
    paste.dataset.slot = String(cornerIndex);
    paste.open = offered.length === 0;
    paste.dataset.defaultOpen = String(paste.open);
    const summary = document.createElement("summary");
    summary.textContent = "Paste a session id instead";
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
      const known = this.detected.find((d) => d.session_id === sessionId);
      this.onAssignSession?.(cornerIndex, sessionId, known ? pickerLabel(known, offered) : sessionId);
    };
    button.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    paste.append(summary, input, button);
    wrap.append(paste);
    return wrap;
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
