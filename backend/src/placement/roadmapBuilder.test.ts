import { describe, expect, it } from "vitest";
import { buildRoadmap, accessDurationToDays, daysUntil } from "./roadmapBuilder.js";
import type { SkillTag } from "./roadmapBuilder.js";

const EVEN_SKILL_PERCENTS: Record<SkillTag, number> = { listening: 50, speaking: 50, reading: 50, writing: 50 };

// Local-calendar-date ISO string N days out — avoids UTC conversion landing on the wrong day (tests run in IST).
function isoDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("accessDurationToDays", () => {
  it("maps fixed durations to fixed day counts", () => {
    expect(accessDurationToDays("1month", null)).toBe(30);
    expect(accessDurationToDays("3months", null)).toBe(90);
    expect(accessDurationToDays("6months", null)).toBe(180);
  });

  it("'untilexam' uses the real exam date, floored at 30 days", () => {
    const in10Days = isoDateDaysFromNow(10);
    expect(accessDurationToDays("untilexam", in10Days)).toBe(30);
    const in100Days = isoDateDaysFromNow(100);
    expect(accessDurationToDays("untilexam", in100Days)).toBe(100);
  });

  it("'untilexam' with no exam date falls back to 90 days", () => {
    expect(accessDurationToDays("untilexam", null)).toBe(90);
  });
});

describe("buildRoadmap", () => {
  it("assessed level meeting or beating the goal is a 'maintenance' plan with no milestones to reach", () => {
    const plan = buildRoadmap({
      assessedLevel: "B2",
      goalLevel: "B1",
      examDate: null,
      accessDuration: "3months",
      dailyMinutesPreference: 30,
      skillPercents: EVEN_SKILL_PERCENTS,
    });
    expect(plan.pace).toBe("maintenance");
    expect(plan.milestones).toHaveLength(1);
    expect(plan.milestones[0].labelType).toBe("maintain");
    expect(plan.milestones[0].level).toBe("B2");
  });

  it("a real level gap produces one 'reach' milestone per level in between, in day order", () => {
    const plan = buildRoadmap({
      assessedLevel: "A2",
      goalLevel: "B2",
      examDate: null,
      accessDuration: "3months",
      dailyMinutesPreference: 30,
      skillPercents: EVEN_SKILL_PERCENTS,
    });
    // A2 -> B2 passes through B1 and B2 themselves (2 steps up).
    expect(plan.milestones.map((m) => m.level)).toEqual(["B1", "B2"]);
    expect(plan.milestones.every((m) => m.labelType === "reach")).toBe(true);
    // Later milestones land later in the access window.
    expect(plan.milestones[1].targetDayOffset).toBeGreaterThan(plan.milestones[0].targetDayOffset);
  });

  it("focuses milestones on the weakest skill first", () => {
    const plan = buildRoadmap({
      assessedLevel: "A2",
      goalLevel: "B1",
      examDate: null,
      accessDuration: "3months",
      dailyMinutesPreference: 30,
      skillPercents: { listening: 90, speaking: 20, reading: 80, writing: 70 },
    });
    expect(plan.milestones[0].focusSkill).toBe("speaking");
  });

  it("clamps minutesPerDay between 15 and 90 regardless of how extreme the gap/deadline math gets", () => {
    const tightDeadline = buildRoadmap({
      assessedLevel: "A1",
      goalLevel: "C2",
      examDate: isoDateDaysFromNow(7),
      accessDuration: "3months",
      dailyMinutesPreference: 30,
      skillPercents: EVEN_SKILL_PERCENTS,
    });
    expect(tightDeadline.minutesPerDay).toBeLessThanOrEqual(90);

    const alreadyThere = buildRoadmap({
      assessedLevel: "C2",
      goalLevel: "C2",
      examDate: null,
      accessDuration: "6months",
      dailyMinutesPreference: 30,
      skillPercents: EVEN_SKILL_PERCENTS,
    });
    expect(alreadyThere.minutesPerDay).toBeGreaterThanOrEqual(15);
  });

  it("never estimates fewer than 5 total hours even for a same-level 'maintenance' plan", () => {
    const plan = buildRoadmap({
      assessedLevel: "B1",
      goalLevel: "B1",
      examDate: null,
      accessDuration: "3months",
      dailyMinutesPreference: 30,
      skillPercents: EVEN_SKILL_PERCENTS,
    });
    expect(plan.totalHoursEstimate).toBeGreaterThanOrEqual(5);
  });
});

describe("daysUntil", () => {
  it("counts whole days to a future date, ignoring time-of-day", () => {
    const in5Days = isoDateDaysFromNow(5);
    expect(daysUntil(in5Days)).toBe(5);
  });
});

describe("buildRoadmap daily minutes", () => {
  it("uses the learner's own daily time when it is more than the plan needs", () => {
    const plan = buildRoadmap({
      assessedLevel: "B1",
      goalLevel: "B2",
      examDate: null,
      accessDuration: "6months",
      dailyMinutesPreference: 60,
      skillPercents: { listening: 50, speaking: 50, reading: 50, writing: 50 },
    });
    expect(plan.minutesPerDay).toBe(60);
  });
});
