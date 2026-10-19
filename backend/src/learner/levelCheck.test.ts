import { describe, expect, it } from "vitest";
import { decide, quickJudge, settleCheck, type CheckAnswer } from "./levelCheck.js";

const a = (level: CheckAnswer["level"], right: boolean): CheckAnswer => ({ itemId: `${level}${Math.random()}`, level, right });

describe("Level check decisions", () => {
  it("moves up after 2 right and stops when the next level is failed", () => {
    expect(decide("B1", [a("B1", true), a("B1", true)])).toEqual({ done: false, level: "B2" });
    expect(decide("B1", [a("B1", true), a("B1", true), a("B2", false), a("B2", false)])).toEqual({ done: true, result: "B1" });
  });
  it("moves down after 2 wrong and stops when the lower level is passed", () => {
    expect(decide("B1", [a("B1", false), a("B1", false), a("A2", true), a("A2", true)])).toEqual({ done: true, result: "A2" });
  });
  it("asks a third question at a level after one right and one wrong", () => {
    expect(decide("B1", [a("B1", true), a("B1", false)])).toEqual({ done: false, level: "B1" });
    expect(decide("B1", [a("B1", true), a("B1", false), a("B1", true)])).toEqual({ done: false, level: "B2" });
  });
  it("ends at the ends of the scale", () => {
    expect(decide("A1", [a("A1", false), a("A1", false)])).toEqual({ done: true, result: "A1" });
    expect(decide("C2", [a("C2", true), a("C2", true)])).toEqual({ done: true, result: "C2" });
  });
  it("settles on the highest level passed when stopped early", () => {
    expect(settleCheck("B1", [a("B1", true), a("B1", true), a("B2", true)])).toBe("B1");
    expect(settleCheck("B1", [a("B1", true)])).toBe("A2");
  });
});

describe("quickJudge", () => {
  it("multiple choice", () => {
    expect(quickJudge("reading_comprehension", {}, { correctIndex: 2 }, "2")).toBe(true);
    expect(quickJudge("reading_comprehension", {}, { correctIndex: 2 }, "1")).toBe(false);
  });
  it("short answers, also inside a spoken sentence", () => {
    const set = { acceptable_answers: ["the front desk", "front desk"] };
    expect(quickJudge("short_answer", {}, set, "They are at the front desk.")).toBe(true);
    expect(quickJudge("short_answer", {}, set, "the back door")).toBe(false);
  });
  it("repeats allow small transcript slips; dictation must be near exact", () => {
    expect(quickJudge("repeats", {}, { exact: "The waiter brought us the wrong soup." }, "the waiter brought us wrong soup")).toBe(true);
    expect(quickJudge("dictation", {}, { exact: "The waiter brought us the wrong soup." }, "the waiter brought us wrong soup")).toBe(false);
  });
  it("read aloud is judged against its text", () => {
    expect(quickJudge("reading", { text: "Our new apartment has a small balcony." }, null, "our new apartment has a small balcony")).toBe(true);
  });
});
