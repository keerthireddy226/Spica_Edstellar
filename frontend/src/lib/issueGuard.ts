// Problems in the room the learner can fix: someone else talking nearby, another
// person on camera, no face in view, a covered or dark camera. Each is warned
// about three times, WARN_GAP_MS apart while it lasts; if it's still there
// after the third warning, the test pauses until it's gone. Once a problem has
// paused the test, it pauses straight away if it comes back in the same test
// (no new round of warnings).

export type IssueKind = "noise" | "extra_person" | "no_face" | "camera_covered";

export const MAX_WARNINGS = 3;
export const WARN_GAP_MS = 20_000;

// Which problem wins when several are present at once.
const PRIORITY: IssueKind[] = ["extra_person", "camera_covered", "no_face", "noise"];

interface Track {
  warnings: number;
  lastWarnAt: number;
  pausedBefore: boolean;
}

export type GuardAction = { type: "warn"; kind: IssueKind; n: number } | { type: "pause"; kind: IssueKind } | { type: "resume"; kind: IssueKind } | null;

export class IssueGuard {
  private tracks = new Map<IssueKind, Track>();
  // The problem the test is paused for, if any.
  paused: IssueKind | null = null;

  private track(kind: IssueKind): Track {
    let t = this.tracks.get(kind);
    if (!t) {
      t = { warnings: 0, lastWarnAt: 0, pausedBefore: false };
      this.tracks.set(kind, t);
    }
    return t;
  }

  // Called about once a second with what is present now. canPause is false
  // once the test's pause allowance is used up: problems are then only warned about.
  step(present: Partial<Record<IssueKind, boolean>>, now: number, canPause = true): GuardAction {
    if (this.paused) {
      if (present[this.paused]) return null;
      const kind = this.paused;
      this.paused = null;
      return { type: "resume", kind };
    }
    for (const kind of PRIORITY) {
      if (!present[kind]) continue;
      const t = this.track(kind);
      if (canPause && t.pausedBefore) return this.pause(kind, t);
      if (t.warnings < MAX_WARNINGS) {
        if (t.warnings === 0 || now - t.lastWarnAt >= WARN_GAP_MS) {
          t.warnings++;
          t.lastWarnAt = now;
          return { type: "warn", kind, n: t.warnings };
        }
        return null;
      }
      if (now - t.lastWarnAt >= WARN_GAP_MS) {
        if (canPause) return this.pause(kind, t);
        // No pausing left: keep reminding, at the same spacing.
        t.lastWarnAt = now;
        return { type: "warn", kind, n: t.warnings };
      }
      return null;
    }
    return null;
  }

  private pause(kind: IssueKind, t: Track): GuardAction {
    t.pausedBefore = true;
    this.paused = kind;
    return { type: "pause", kind };
  }

  // The server refused to pause (allowance used up): back to warnings only.
  cancelPause() {
    this.paused = null;
  }

  // Warnings given and problems that paused the test, so a page reload
  // doesn't start the warnings over. A pause in progress isn't kept: if the
  // problem is still there after the reload, it pauses again straight away.
  save(): string {
    return JSON.stringify([...this.tracks.entries()]);
  }

  static restore(saved: string | null): IssueGuard {
    const g = new IssueGuard();
    try {
      const entries = saved ? (JSON.parse(saved) as [IssueKind, Track][]) : [];
      for (const [kind, t] of entries) {
        if (PRIORITY.includes(kind)) g.tracks.set(kind, { warnings: Number(t.warnings) || 0, lastWarnAt: Number(t.lastWarnAt) || 0, pausedBefore: !!t.pausedBefore });
      }
    } catch {
      // A damaged saved state starts over.
    }
    return g;
  }
}
