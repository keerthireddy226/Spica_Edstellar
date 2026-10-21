import { describe, expect, it } from "vitest";
import { buildIcs, googleLink, type PlanEvent } from "./calendar.js";

const events: PlanEvent[] = [
  { date: "2026-11-02", kind: "practice_test", uid: "u1-practice_test-1@spica" },
  { date: "2026-12-31", kind: "mock", uid: "u1-mock-1@spica" },
];

describe("test plan calendar", () => {
  it("builds all-day events that keep their UIDs", () => {
    const ics = buildIcs(events, new Date("2026-10-19T10:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("UID:u1-practice_test-1@spica");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261103");
    // Across a year end.
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(ics).toContain("DTSTAMP:20261019T100000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("links each date to Google Calendar", () => {
    const url = new URL(googleLink(events[1]));
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261231/20270101");
    expect(url.searchParams.get("text")).toBe("Spica: mock test");
  });
});
