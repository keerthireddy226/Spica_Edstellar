import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ pool: { query: vi.fn() } }));
vi.mock("../quality/settings.js", () => ({ qualitySettings: async () => ({ levelPassOverall: 70, levelSkillMin: 50 }) }));

const { levelTestOutcome, settledResult, summarizeScores, unscoredCount } = await import("./sessionScore.js");

const row = (skills: string[], status: string, score: number | null, text: string | null = "answer") => ({
  status,
  content_score: score,
  manner_scores: null,
  input_method: "text",
  skills,
  cefr_level: "B1",
  part_label: skills[0],
  response_text: text,
  response_uri: null,
});

describe("level test outcome", () => {
  it("is not decided while an answer's AI scoring failed", async () => {
    const s = summarizeScores([row(["reading"], "scored", 1), row(["listening"], "scored", 1), row(["speaking"], "failed", null)]);
    expect(s.failedCount).toBe(1);
    const o = await levelTestOutcome("B1", s);
    expect(o.passed).toBeNull();
    expect(o.unscored).toBe(1);
  });

  it("is decided once every answer is scored, blanks counting as wrong", async () => {
    const s = summarizeScores([row(["reading"], "scored", 1), row(["listening"], "scored", 1), row(["speaking"], "pending", null, null)]);
    expect(s.skippedCount).toBe(1);
    const o = await levelTestOutcome("B1", s);
    expect(o.passed).toBe(false);
    expect(o).not.toHaveProperty("unscored");
  });
});

describe("settled result", () => {
  it("waits while an answer is still being scored or its scoring failed", async () => {
    const pending = summarizeScores([row(["reading"], "scored", 1), row(["speaking"], "pending", null)]);
    expect(unscoredCount(pending)).toBe(1);
    expect(await settledResult(null, pending, null)).toBeNull();
    const failed = summarizeScores([row(["reading"], "scored", 1), row(["speaking"], "failed", null)]);
    expect(await settledResult("B1", failed, null)).toBeNull();
  });

  it("saves every figure once all answers are scored, blanks counting as wrong", async () => {
    const s = summarizeScores([row(["reading"], "scored", 1), row(["listening"], "scored", 1), row(["speaking"], "pending", null, null)]);
    expect(unscoredCount(s)).toBe(0);
    const r = await settledResult(null, s, null);
    expect(r).not.toBeNull();
    expect(r!.overallPercent).toBe(67);
    expect(r!.skillPercents).toEqual(s.level?.skillPercents);
    expect(r!.cefrLevel).toBe(s.level?.cefrLevel ?? null);
    expect(r).not.toHaveProperty("levelTest");
  });

  it("decides a level test with the rest", async () => {
    const s = summarizeScores([row(["reading"], "scored", 1), row(["listening"], "scored", 1), row(["speaking"], "scored", 1)]);
    const r = await settledResult("B1", s, null);
    expect(r!.levelTest).toMatchObject({ level: "B1", passed: true });
  });
});
