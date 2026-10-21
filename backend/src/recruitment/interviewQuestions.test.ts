import { describe, expect, it } from "vitest";
import { interviewQuestions } from "./interviewQuestions.js";

describe("interviewQuestions", () => {
  it("probes skills below the job's minimum at the job's level", () => {
    const q = interviewQuestions({ skillLevels: { speaking: "A2", listening: "B2", reading: "B2", writing: "B2" } }, "B2");
    expect(q.filter((x) => x.reason === "below_minimum").map((x) => x.skill)).toEqual(["speaking", "speaking"]);
    expect(q.find((x) => x.skill === "speaking")!.question).toMatch(/problem you solved|customer/);
    expect(new Set(q.map((x) => x.skill)).size).toBe(2);
  });
  it("without a minimum, the two weakest skills", () => {
    const q = interviewQuestions({ skillLevels: { speaking: "C1", listening: "B1", reading: "C1", writing: "B2" } }, null);
    expect([...new Set(q.map((x) => x.skill))]).toEqual(["listening", "writing"]);
    expect(q.every((x) => x.reason === "weakest")).toBe(true);
  });
  it("nothing without skill levels", () => {
    expect(interviewQuestions(null, "B2")).toEqual([]);
  });
});
