// A corner's session card (quality check Q4/Q5/C3, 2026-09-23). The activity is the corner's
// headline, coloured by kind and always with a glyph and words too (never colour alone, the
// rule styles.css carries over from Sophi-A). Rows show a chip only when a value is not
// simply reported: "estimated" or "UNKNOWN". Every row's tooltip is the field's `source`, the
// provenance PLAN.md §2.1 has the reader attach to every field. Times are relative and kept
// current in place by `refreshRelativeTimes`, not by rebuilding the card.

import type { Field, RegisteredSession, SessionSnapshot } from "./types.js";

// Brief 04 P2 (2026-09-25): "blocked" (a permission prompt or question stops the session),
// "yourTurn" (the turn is over and the prompt has sat idle) and "error" (the turn ended on an
// API error, e.g. a rate limit) replace the one old "waiting".
export type ActivityKind = "working" | "blocked" | "yourTurn" | "error" | "idle" | "ended" | "stale" | "unknown";

const GLYPH: Record<ActivityKind, string> = {
  working: "▶",
  blocked: "◆",
  yourTurn: "●",
  error: "!",
  idle: "○",
  ended: "✕",
  stale: "…",
  unknown: "?",
};

/** Sorts the readers' activity labels into the kinds the headline colours. */
export function activityKind(value: string | null): ActivityKind {
  if (!value) return "unknown";
  if (value.startsWith("running tool") || value.startsWith("processing")) return "working";
  if (value.startsWith("blocked:")) return "blocked";
  if (value === "your turn") return "yourTurn";
  if (value.startsWith("failed:")) return "error";
  if (value.startsWith("idle") || value === "ready") return "idle";
  if (value.startsWith("ended")) return "ended";
  if (value.startsWith("stale")) return "stale";
  return "unknown";
}

/** "40s ago" / "in 3h 12m", relative to now. */
export function fmtRelative(epochS: number, nowS = Math.floor(Date.now() / 1000)): string {
  const d = epochS - nowS;
  const s = Math.abs(d);
  const span = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return d > 0 ? `in ${span}` : `${span} ago`;
}

/** Local date and time, for a relative time's tooltip (egress audit #4: the date was missing). */
export function fmtAbsolute(epochS: number): string {
  return new Date(epochS * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtHourMinute(epochS: number): string {
  return new Date(epochS * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** A span whose text `refreshRelativeTimes` keeps current. */
function relativeTime(epochS: number): HTMLElement {
  const el = document.createElement("time");
  el.className = "rel-time";
  el.dataset.epoch = String(epochS);
  el.dateTime = new Date(epochS * 1000).toISOString();
  el.title = fmtAbsolute(epochS);
  el.textContent = fmtRelative(epochS);
  return el;
}

/** Re-renders every relative time under `root` in place (GridShell's 15 s tick). */
export function refreshRelativeTimes(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".rel-time").forEach((el) => {
    const text = fmtRelative(Number(el.dataset.epoch));
    if (el.textContent !== text) el.textContent = text;
  });
}

function chipFor(availability: Field<unknown>["availability"]): HTMLElement | null {
  if (availability === "exposed") return null;
  const chip = document.createElement("span");
  chip.className = "availability-chip";
  chip.dataset.availability = availability;
  chip.textContent = availability === "approximable" ? "estimated" : "UNKNOWN";
  return chip;
}

function row(label: string, field: Field<unknown>, value: Node | string): HTMLElement {
  const r = document.createElement("div");
  r.className = "field-row";
  r.dataset.field = label;
  r.title = field.source;
  const labelEl = document.createElement("span");
  labelEl.className = "label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "value";
  const known = field.availability !== "unknown" && field.value !== null;
  valueEl.append(known ? value : "—");
  const chip = chipFor(field.availability);
  if (chip) valueEl.append(" ", chip);
  r.append(labelEl, valueEl);
  return r;
}

function pct(f: Field<number>): string {
  return f.value === null ? "—" : `${f.value.toFixed(0)}%`;
}

function whenNode(f: Field<number>): Node | string {
  return f.value === null ? "—" : relativeTime(f.value);
}

function turnNode(f: Field<string>): Node | string {
  if (f.value === null) return "—";
  // "worked for 2m 3s" ends at the Stop the reader stamped as observed_at: "· done 14:20".
  if (f.value.startsWith("worked for") && f.observed_at !== null) return `${f.value} · done ${fmtHourMinute(f.observed_at)}`;
  return f.value;
}

export function buildHeadline(snap: SessionSnapshot | null): HTMLElement {
  const p = document.createElement("p");
  p.className = "activity-headline";
  const value = snap?.activityState.value ?? null;
  const kind = activityKind(value);
  p.dataset.kind = kind;
  p.title = snap?.activityState.source ?? "no snapshot yet";
  const glyph = document.createElement("span");
  glyph.className = "glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = GLYPH[kind];
  p.append(glyph, " ", value ?? (snap ? "activity unknown" : "no snapshot yet"));
  return p;
}

export function buildFullCard(session: RegisteredSession): HTMLElement {
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
  const snap = session.snapshot;
  wrap.append(h2, buildHeadline(snap));
  if (!snap) return wrap;

  const spend = snap.tokenSpend.usd;
  wrap.append(
    row("model", snap.model, snap.model.value?.display_name ?? "—"),
    row("effort", snap.effort, snap.effort.value ?? "—"),
    row("context", snap.contextPercent, pct(snap.contextPercent)),
    row("turn", snap.durationLine, turnNode(snap.durationLine)),
    row("usage", snap.usagePercent, pct(snap.usagePercent)),
    row("resets", snap.resetTimer, whenNode(snap.resetTimer)),
    row("last active", snap.lastActiveTime, whenNode(snap.lastActiveTime)),
    row("spend", spend, spend.value !== null ? `$${spend.value.toFixed(2)}` : "—"),
  );
  return wrap;
}

/** The one-line card below the pane floor (Q7): name · activity · context. */
export function buildCompactCard(session: RegisteredSession): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "compact-card";
  const snap = session.snapshot;
  const headline = buildHeadline(snap);
  headline.classList.add("compact-activity");
  const name = document.createElement("span");
  name.className = "compact-name";
  name.textContent = session.label;
  wrap.append(name, headline);
  if (snap && snap.contextPercent.value !== null) {
    const ctx = document.createElement("span");
    ctx.className = "compact-ctx";
    ctx.title = snap.contextPercent.source;
    ctx.textContent = `ctx ${pct(snap.contextPercent)}`;
    wrap.append(ctx);
  }
  return wrap;
}
