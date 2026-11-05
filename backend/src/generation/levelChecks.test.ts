import { describe, expect, it } from "vitest";
import { vocabularyCheck, wordLevel } from "./levelChecks.js";

describe("wordLevel", () => {
  it("finds a word's level through its inflections", () => {
    expect(wordLevel("book")).toBe("A1");
    expect(wordLevel("books")).toBe("A1");
    expect(wordLevel("stopped")).not.toBeNull();
    expect(wordLevel("Zanzibar")).toBeNull();
  });
});

describe("vocabularyCheck", () => {
  it("passes everyday words at A2", () => {
    expect(vocabularyCheck("The meeting starts at nine.", "A2").ok).toBe(true);
  });

  it("fails an A1 sentence with advanced words", () => {
    const r = vocabularyCheck("The shareholders scrutinised the unprecedented acquisition.", "A1");
    expect(r.ok).toBe(false);
    expect(r.notes?.[0]).toMatch(/words above A1/);
  });

  it("has no ceiling at C2", () => {
    expect(vocabularyCheck("The shareholders scrutinised the unprecedented acquisition.", "C2").ok).toBe(true);
  });
});
