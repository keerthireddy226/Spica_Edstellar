import { describe, expect, it } from "vitest";
import { goalStatus, memberStatus, projectLevel } from "./monitoring.js";

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("projectLevel", () => {
  it("extends the trend to the target day", () => {
    // A1 (0) 60 days ago, A2 (1) 30 days ago: one level a month.
    expect(projectLevel([{ day: 0, level: 0 }, { day: 30, level: 1 }], 90)).toBeCloseTo(3);
  });
  it("needs two mocks on different days", () => {
    expect(projectLevel([{ day: 5, level: 2 }], 30)).toBeNull();
    expect(projectLevel([{ day: 5, level: 2 }, { day: 5, level: 3 }], 30)).toBeNull();
  });
});

describe("memberStatus", () => {
  const base = { targetLevel: "B2", missed: 0, inactiveDays: 1, daysLeft: 60 };
  it("is at target when the gap is closed", () => {
    expect(memberStatus({ ...base, gap: 0, mocks: [] }).status).toBe("at_target");
  });
  it("follows the trend across mocks", () => {
    const rising = [
      { sessionId: "a", date: day(60), cefrLevel: "A2", percent: 40, skillLevels: null },
      { sessionId: "b", date: day(30), cefrLevel: "B1", percent: 55, skillLevels: null },
    ];
    expect(memberStatus({ ...base, gap: 1, mocks: rising }).status).toBe("on_track");
    const flat = rising.map((m) => ({ ...m, cefrLevel: "A2" }));
    const r = memberStatus({ ...base, gap: 2, mocks: flat });
    expect(r.status).toBe("at_risk");
    expect(r.projected).toBe("A2");
  });
  it("without a trend, flags missed tests, inactivity and too little time", () => {
    expect(memberStatus({ ...base, gap: 1, mocks: [], missed: 2 }).status).toBe("at_risk");
    expect(memberStatus({ ...base, gap: 1, mocks: [], inactiveDays: 20 }).status).toBe("at_risk");
    expect(memberStatus({ ...base, gap: 2, mocks: [], daysLeft: 10 }).status).toBe("at_risk");
    expect(memberStatus({ ...base, gap: 1, mocks: [] }).status).toBe("too_early");
  });
});

describe("goalStatus", () => {
  const now = Date.parse("2026-10-22T00:00:00Z");
  const base = {
    targetLevel: "B2",
    mocks: [],
    missed: 0,
    lastActivity: "2026-10-21T00:00:00Z",
    startedOn: "2026-09-01",
    goalDate: "2026-12-31",
    now,
  };
  it("counts a skill's own target in the gap", () => {
    const level = { overall: "B2", skills: { speaking: "B1" } };
    expect(goalStatus({ ...base, level }).status).toBe("at_target");
    const r = goalStatus({ ...base, level, targetSkills: { speaking: "B2" } });
    expect(r.gap).toBe(1);
    expect(r.status).toBe("too_early");
    expect(r.why).toEqual({ code: "too_early" });
  });
  it("counts never active as inactive since the goal began", () => {
    const r = goalStatus({ ...base, level: { overall: "B1", skills: null }, lastActivity: null });
    expect(r.status).toBe("at_risk");
    expect(r.inactiveDays).toBeNull();
    expect(r.why).toEqual({ code: "inactive", days: 51 });
    expect(r.reason).toBe("no activity for 51 days");
  });
  it("gives a year when there's no target date", () => {
    expect(goalStatus({ ...base, level: { overall: "A2", skills: null }, goalDate: null }).daysLeft).toBe(365);
    const short = goalStatus({ ...base, level: { overall: "A2", skills: null }, goalDate: "2026-11-01" });
    expect(short.status).toBe("at_risk");
    expect(short.why).toEqual({ code: "time_short", gap: 2, days: 10 });
  });
});
