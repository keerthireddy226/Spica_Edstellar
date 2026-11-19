import { describe, expect, it } from "vitest";
import { splitDemoUse } from "./demoLicences.js";

const at = (d: string) => new Date(d + "T10:00:00Z").getTime();

describe("splitDemoUse", () => {
  it("takes used licences from the earliest-ending valid gift first", () => {
    const r = splitDemoUse(
      [
        { licences: 5, createdAt: at("2026-11-01"), expired: false, vu: null },
        { licences: 5, createdAt: at("2026-11-01"), expired: false, vu: "2026-12-31" },
      ],
      [{ at: at("2026-11-05"), day: "2026-11-05" }],
    );
    expect(r).toEqual({ left: 9, expired: 0, useBy: "2026-12-31" });
  });
  it("doesn't count a demo given after a gift expired against that gift", () => {
    // 10 valid until 10 Nov (none used, now expired), 10 with no date; one learner on 15 Nov.
    const r = splitDemoUse(
      [
        { licences: 10, createdAt: at("2026-11-01"), expired: true, vu: "2026-11-10" },
        { licences: 10, createdAt: at("2026-11-01"), expired: false, vu: null },
      ],
      [{ at: at("2026-11-15"), day: "2026-11-15" }],
    );
    expect(r).toEqual({ left: 9, expired: 10, useBy: null });
  });
  it("counts demos given before the date against the expiring gift", () => {
    const r = splitDemoUse(
      [
        { licences: 3, createdAt: at("2026-11-01"), expired: true, vu: "2026-11-10" },
        { licences: 4, createdAt: at("2026-11-02"), expired: false, vu: null },
      ],
      [
        { at: at("2026-11-03"), day: "2026-11-03" },
        { at: at("2026-11-10"), day: "2026-11-10" },
        { at: at("2026-11-12"), day: "2026-11-12" },
      ],
    );
    expect(r).toEqual({ left: 3, expired: 1, useBy: null });
  });
  it("doesn't use a gift given after the learner's demo started", () => {
    const r = splitDemoUse(
      [
        { licences: 2, createdAt: at("2026-11-01"), expired: false, vu: null },
        { licences: 2, createdAt: at("2026-11-20"), expired: false, vu: "2026-11-25" },
      ],
      [{ at: at("2026-11-05"), day: "2026-11-05" }],
    );
    expect(r).toEqual({ left: 3, expired: 0, useBy: "2026-11-25" });
  });
});
