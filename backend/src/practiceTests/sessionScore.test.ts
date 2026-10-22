import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ pool: { query: vi.fn() } }));
vi.mock("../quality/settings.js", () => ({ qualitySettings: async () => ({ levelPassOverall: 70, levelSkillMin: 50 }) }));

const { levelTestOutcome, summarizeScores } = await import("./sessionScore.js");

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
