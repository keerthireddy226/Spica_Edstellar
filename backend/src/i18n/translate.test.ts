import { describe, expect, it } from "vitest";
import { bySentence, localizeDate, translateServerText } from "./translate.js";

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

describe("localizeDate", () => {
  it("shows English dates in the reader's language", () => {
    expect(localizeDate("de", "20 Nov 2026")).toBe("20. Nov. 2026");
    expect(localizeDate("fr", "5 December 2026")).toBe("5 décembre 2026");
    expect(localizeDate("ja", "20 Nov 2026")).toBe("2026年11月20日");
  });
  it("leaves anything that is not a date alone", () => {
    expect(localizeDate("de", "Nov 2026")).toBe("Nov 2026");
    expect(localizeDate("de", "20 Spica 2026")).toBe("20 Spica 2026");
  });
  it("leaves English text untouched", () => {
    expect(translateServerText("en", "Your demo ends on 20 Nov 2026.")).toBe("Your demo ends on 20 Nov 2026.");
  });
});
