import type { CornerIndex, RegisteredSession, SessionSnapshot } from "./types.js";

/**
 * Tracks which session (if any) is assigned to each of the four fixed corner slots,
 * plus an overflow list for a fifth-and-later registered session (PLAN.md §4:
 * "the fifth and later registered sessions go into the same keyboard-accessible tab
 * strip the small-viewport breakpoint already uses"). Registration is always an
 * explicit call naming a session_id — this class never scans for or guesses one
 * (PLAN.md §2.1).
 */
export class PaneRegistry {
  private corners: (RegisteredSession | null)[] = [null, null, null, null];
  private overflow: RegisteredSession[] = [];

  registerToCorner(corner: CornerIndex, session: RegisteredSession): void {
    this.unregister(session.sessionId); // a session only ever occupies one slot
    this.corners[corner] = session;
  }

  registerOverflow(session: RegisteredSession): void {
    this.unregister(session.sessionId);
    this.overflow.push(session);
  }

  unregister(sessionId: string): void {
    this.corners = this.corners.map((s) => (s?.sessionId === sessionId ? null : s)) as typeof this.corners;
    this.overflow = this.overflow.filter((s) => s.sessionId !== sessionId);
  }

  updateSnapshot(sessionId: string, snapshot: SessionSnapshot): void {
    for (let i = 0; i < this.corners.length; i++) {
      if (this.corners[i]?.sessionId === sessionId) this.corners[i] = { ...this.corners[i]!, snapshot };
    }
    this.overflow = this.overflow.map((s) => (s.sessionId === sessionId ? { ...s, snapshot } : s));
  }

  /** Always length 4 — an empty slot is `null`, never omitted, so the shell always
   * renders the same fixed frame (PLAN.md §4: "never a re-flow that hides them"). */
  getCorners(): (RegisteredSession | null)[] {
    return [...this.corners];
  }

  /** Fifth-and-later registered sessions, for the tab strip. */
  getOverflow(): RegisteredSession[] {
    return [...this.overflow];
  }

  /** Every registered session, corners first in slot order then overflow — the order
   * the small-viewport tab strip and the session-count tab strip both use. */
  getAllTabEntries(): RegisteredSession[] {
    return [...this.corners.filter((s): s is RegisteredSession => s !== null), ...this.overflow];
  }
}
