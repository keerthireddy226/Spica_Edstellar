import { describe, expect, it } from "vitest";
import { adaptiveLevel } from "./adaptive.js";

const q = (level: string, correct: boolean | null) => ({ level, correct });

describe("adaptiveLevel", () => {
  it("starts at the skill's level", () => {
    expect(adaptiveLevel("B1", [])).toBe("B1");
  });
  it("two right in a row moves up, two wrong moves down", () => {
    expect(adaptiveLevel("B1", [q("B1", true), q("B1", true)])).toBe("B2");
    expect(adaptiveLevel("B1", [q("B1", false), q("B1", false)])).toBe("A2");
  });
  it("mixed results stay at the level", () => {
    expect(adaptiveLevel("B1", [q("B1", true), q("B1", false)])).toBe("B1");
  });
  it("counts only answers since reaching the level", () => {
    // Up to B2 after two right; one right at B2 isn't two yet.
    expect(adaptiveLevel("B1", [q("B1", true), q("B1", true), q("B2", true)])).toBe("B2");
  });
  it("an unmarked answer (speaking still being scored) doesn't count", () => {
    expect(adaptiveLevel("B1", [q("B1", true), q("B1", null)])).toBe("B1");
  });
  it("stays within A1 to C2", () => {
    expect(adaptiveLevel("C2", [q("C2", true), q("C2", true)])).toBe("C2");
    expect(adaptiveLevel("A1", [q("A1", false), q("A1", false)])).toBe("A1");
  });
});
