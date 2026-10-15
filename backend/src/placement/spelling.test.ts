import { describe, expect, it } from "vitest";
import { canonicalSpelling } from "./spelling.js";

describe("canonicalSpelling", () => {
  it("turns British spellings into one form", () => {
    expect(canonicalSpelling("the organisation's centre is grey")).toBe("the organization's center is gray");
    expect(canonicalSpelling("she learnt to practise the programme")).toBe("she learned to practice the program");
    expect(canonicalSpelling("colourful behaviour in the neighbourhood")).toBe("colorful behavior in the neighborhood");
  });

  it("leaves American spellings unchanged", () => {
    expect(canonicalSpelling("the organization's center is gray")).toBe("the organization's center is gray");
  });

  it("never merges two different words", () => {
    for (const phrase of ["four for", "holy holly", "mourning morning", "tour tor", "poet pet", "filing filling", "willing wiling"]) {
      expect(canonicalSpelling(phrase)).toBe(phrase);
    }
  });
});
