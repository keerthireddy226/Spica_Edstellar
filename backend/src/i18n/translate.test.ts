import { describe, expect, it } from "vitest";
import { bySentence } from "./translate.js";

const dict: Record<string, string> = { "A.": "Eins.", "B!": "Zwei!", "Line one": "Zeile eins" };
const t = (s: string) => dict[s] ?? s;

describe("bySentence", () => {
  it("translates each sentence and keeps the spacing", () => {
    expect(bySentence("A. B!", t)).toBe("Eins. Zwei!");
    expect(bySentence("A.  Unknown.", t)).toBe("Eins.  Unknown.");
  });
  it("translates line by line", () => {
    expect(bySentence("Line one\n\nA. B!", t)).toBe("Zeile eins\n\nEins. Zwei!");
  });
  it("leaves a single sentence alone", () => {
    expect(bySentence("Nothing to split", t)).toBe("Nothing to split");
  });
});
