import { describe, expect, it } from "vitest";
import { bankToUse } from "./banks.js";
import { pickBankForm, type BankRow } from "../practiceTests/modes.js";

describe("bankToUse", () => {
  it("uses the bank asked for once it has exams", () => {
    expect(bankToUse("mock", true)).toBe("mock");
    expect(bankToUse("assessment", true)).toBe("assessment");
  });
  it("falls back to the practice sets until the bank is loaded", () => {
    expect(bankToUse("mock", false)).toBe("practice");
    expect(bankToUse("assessment", false)).toBe("practice");
    expect(bankToUse("practice", false)).toBe("practice");
  });
});

// Rows of a bank: `exams` forms, each with a 3-question part 1 and a 2-question part 2.
function bank(exams: string[], opts: Partial<BankRow> = {}): BankRow[] {
  return exams.flatMap((e) => [
    ...[1, 2, 3].map((n) => ({ id: `${e}-1-${n}`, exam_id: e, exam_order: n, sort_order: 1, part_label: "Repeats", content: { text: `${e} ${n}` }, mock_approved: true, ...opts })),
    ...[1, 2].map((n) => ({ id: `${e}-2-${n}`, exam_id: e, exam_order: n, sort_order: 2, part_label: "Dictation", content: { text: `${e} d${n}` }, mock_approved: true, ...opts })),
  ]);
}
const targets = new Map([
  [1, 3],
  [2, 2],
]);

describe("pickBankForm", () => {
  it("fills each section to the template's length from the bank only", () => {
    const rows = bank(["m1", "m2", "m3"]);
    const ids = pickBankForm(rows, targets, new Set(), "practice-set-1");
    expect(ids).toHaveLength(5);
    expect(ids.every((id) => rows.some((r) => r.id === id))).toBe(true);
    expect(ids.slice(0, 3).every((id) => id.includes("-1-"))).toBe(true);
    expect(ids.slice(3).every((id) => id.includes("-2-"))).toBe(true);
  });

  it("takes questions the learner hasn't seen first", () => {
    const rows = bank(["m1", "m2"]);
    const seen = new Set(rows.filter((r) => r.exam_id === "m1").map((r) => r.id));
    expect(pickBankForm(rows, targets, seen, "practice-set-1").every((id) => id.startsWith("m2"))).toBe(true);
  });

  it("keeps questions used in many real tests out while others remain", () => {
    const rows = [...bank(["a1"], { certified_exposures: 50 }), ...bank(["a2"], { certified_exposures: 0 })];
    expect(pickBankForm(rows, targets, new Set(), "practice-set-1", 40).every((id) => id.startsWith("a2"))).toBe(true);
  });

  it("leaves out questions not approved for mocks", () => {
    const rows = [...bank(["m1"], { mock_approved: false }), ...bank(["m2"])];
    expect(pickBankForm(rows, targets, new Set(), "practice-set-1").every((id) => id.startsWith("m2"))).toBe(true);
  });

  it("uses one form's whole section when the draw can't fill it exactly", () => {
    // Only m1 is approved for mocks, and its part 1 is one question short; m2's part 1 is complete.
    const rows = [...bank(["m1"]).filter((r) => r.id !== "m1-1-3"), ...bank(["m2"], { mock_approved: false })];
    const ids = pickBankForm(rows, targets, new Set(), "practice-set-1");
    expect(ids.slice(0, 3)).toEqual(["m2-1-1", "m2-1-2", "m2-1-3"]);
  });
});
