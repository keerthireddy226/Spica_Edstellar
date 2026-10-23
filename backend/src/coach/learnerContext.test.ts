import { describe, expect, it } from "vitest";
import { describeNextStep, formatLearnerContext, type LearnerFacts } from "./learnerContext.js";
import { buildSystemInstruction } from "./coachGemini.js";

const empty: LearnerFacts = {
  firstName: null,
  currentLevel: null,
  goalLevel: null,
  targetExam: null,
  examReason: null,
  examDate: null,
  examDaysLeft: null,
  dailyMinutes: null,
  streakDays: 0,
  skillAccuracy: {},
  weakTypes: [],
  lastTest: null,
};

describe("formatLearnerContext", () => {
  it("returns an empty block when nothing is known", () => {
    expect(formatLearnerContext(empty)).toBe("");
  });

  it("renders every known fact on its own line", () => {
    const text = formatLearnerContext({
      firstName: "Asha",
      currentLevel: "B1",
      goalLevel: "B2",
      targetExam: "Versant",
      examReason: "a job",
      examDate: "2026-12-01",
      examDaysLeft: 43,
      dailyMinutes: 20,
      streakDays: 1,
      skillAccuracy: { speaking: { correct: 6, graded: 10 }, reading: { correct: 9, graded: 10 } },
      weakTypes: [{ name: "Sentence Builds", accuracy: 25, graded: 8 }],
      lastTest: { kind: "mock test", testName: "English 4-Skills Essentials Test", date: "2026-10-10", level: "B1", percent: 52 },
    });
    expect(text.split("\n")).toEqual([
      "First name: Asha.",
      "Current CEFR level: B1 (latest placement); goal level: B2.",
      "Preparing for Versant for a job.",
      "Exam date: 2026-12-01 (43 days left).",
      "Plans to practise 20 minutes a day.",
      "Practice streak: 1 day.",
      "Accuracy by skill (last 30 days of practice): speaking 60%, reading 90%.",
      "Weakest question types recently: Sentence Builds (25% of 8).",
      "Last mock test (English 4-Skills Essentials Test) on 2026-10-10: estimated level B1, 52% overall.",
    ]);
  });

  it("omits thin skill evidence, past exam dates and empty test results", () => {
    const text = formatLearnerContext({
      ...empty,
      examReason: "immigration",
      examDate: "2026-01-01",
      examDaysLeft: -10,
      skillAccuracy: { writing: { correct: 1, graded: 2 } },
      lastTest: { kind: "practice test", testName: null, date: "2026-10-01", level: null, percent: null },
    });
    expect(text).toBe("Studying English for immigration.\nLast practice test on 2026-10-01.");
  });

  it("stays within the ~150-word budget when fully populated", () => {
    const text = formatLearnerContext({
      ...empty,
      firstName: "Asha",
      currentLevel: "A2",
      goalLevel: "C1",
      targetExam: "IELTS",
      examReason: "university admission",
      examDate: "2027-01-01",
      examDaysLeft: 74,
      dailyMinutes: 45,
      streakDays: 12,
      skillAccuracy: Object.fromEntries(
        (["listening", "speaking", "reading", "writing"] as const).map((s) => [s, { correct: 5, graded: 10 }]),
      ),
      weakTypes: [
        { name: "Passage Reconstruction", accuracy: 10, graded: 10 },
        { name: "Sentence Builds", accuracy: 20, graded: 10 },
        { name: "Story Retelling", accuracy: 30, graded: 10 },
      ],
      lastTest: { kind: "practice test", testName: "English Speaking and Listening Test", date: "2026-10-10", level: "A2", percent: 31 },
    });
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(150);
  });
});

describe("buildSystemInstruction", () => {
  it("adds the learner section only when there is context", () => {
    expect(buildSystemInstruction("")).not.toContain("What you know about this learner");
    const withCtx = buildSystemInstruction("Current CEFR level: B1 (latest placement).");
    expect(withCtx).toContain("What you know about this learner");
    expect(withCtx).toContain("Current CEFR level: B1");
    expect(withCtx).toContain("never invent");
  });
});

describe("journey facts for the tutor", () => {
  const base = { firstName: null, currentLevel: "B1", goalLevel: "B2", targetExam: null, examReason: null, examDate: null, examDaysLeft: null, dailyMinutes: null, streakDays: 0, skillAccuracy: {}, weakTypes: [], lastTest: null };

  it("lists skill levels, the mock prediction, the final assessment, the certificate and the next step", () => {
    const text = formatLearnerContext({
      ...base,
      skillLevels: { listening: "B2", speaking: "B1", reading: "B1", writing: "A2" },
      predicted: { score: 51, level: "B1", mocks: 2 },
      goalScore: 55,
      finalAssessment: { testName: "English 4 Skills Essentials", chooseTest: false, state: "mock_needed", opensOn: "2026-11-20" },
      certificate: null,
      nextStep: describeNextStep({ kind: "retry", skill: "writing", count: 6, types: ["Dictation"] }),
    });
    expect(text).toContain("listening B2, speaking B1, reading B1, writing A2");
    expect(text).toContain("predict Spica score 51, level B1; the goal level needs 55 (4 points to go)");
    expect(text).toContain("English 4 Skills Essentials");
    expect(text).toContain("opens after one mock test");
    expect(text).toContain("Recommended next step in Spica: Retry 6 earlier mistakes in writing (Dictation) in Practice Modules.");
  });

  it("describes every kind of next step, and none when there is nothing", () => {
    expect(describeNextStep(null)).toBeNull();
    expect(describeNextStep({ kind: "final", chooseTest: true })).toContain("Choose the test");
    expect(describeNextStep({ kind: "mock", daysLeft: 1 })).toContain("in 1 day.");
    expect(describeNextStep({ kind: "practice_test", daysSince: 9 })).toContain("practice test");
  });
});

describe("tutor stays on Spica", () => {
  it("tells the model to decline unrelated topics and to use Spica's own facts", () => {
    const sys = buildSystemInstruction("");
    expect(sys).toContain("only help with their English learning in Spica");
    expect(sys).toContain("Do not answer the unrelated question");
    expect(sys).toContain("only way to earn a certificate");
    expect(sys).toContain("placement test");
  });
});
