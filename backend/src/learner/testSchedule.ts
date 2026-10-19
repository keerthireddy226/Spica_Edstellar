// The test plan on My journey: practice tests and mock exams spaced by the
// learner's plan (how many of each a month), up to the exam (or 8 weeks).

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface ScheduleInput {
  today: Date;
  examDate: Date | null;
  lastPractice: Date | null;
  lastMock: Date | null;
  // Mocks a month (null: no limit), how many are left now, and when the
  // monthly count starts again.
  mocksPerMonth: number | null;
  mocksLeft: number | null;
  // The same for practice tests (both counts start again on resetsOn).
  practicePerMonth?: number | null;
  practiceLeft?: number | null;
  resetsOn: Date | null;
}

export interface Slot {
  date: Date;
  kind: "practice_test" | "mock";
  // A mock placed on the day new mocks arrive.
  onReset?: boolean;
  // A mock would be within the allowance on this date.
  mockAllowed?: boolean;
}

const addMonth = (d: Date) => {
  const n = new Date(d);
  n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
};

export function scheduleTests(input: ScheduleInput): Slot[] {
  const perMonth = input.mocksPerMonth;
  // Weeks between mocks: one a month means every fourth week, otherwise
  // every other week, so there's always a practice test in between.
  const gap = perMonth !== null && perMonth <= 1 ? 4 : 2;
  const end = input.examDate ? new Date(input.examDate.getTime() - 2 * DAY_MS) : new Date(input.today.getTime() + 8 * WEEK_MS);
  // This week's test if none in the last 7 days, else a week after the last one.
  const last = [input.lastPractice, input.lastMock].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  let at = last && input.today.getTime() - last.getTime() < WEEK_MS ? new Date(last.getTime() + WEEK_MS) : new Date(input.today);

  let left = perMonth === null ? Infinity : (input.mocksLeft ?? perMonth);
  // Practice tests: weekly when there's no limit (or four or more a month),
  // every other week with two or three, monthly with one.
  const practicePerMonth = input.practicePerMonth ?? null;
  const practiceGap = practicePerMonth === null || practicePerMonth >= 4 ? 1 : practicePerMonth >= 2 ? 2 : 4;
  let practiceLeft = practicePerMonth === null ? Infinity : (input.practiceLeft ?? practicePerMonth);
  let weeksSincePractice = input.lastPractice ? Math.floor((input.today.getTime() - input.lastPractice.getTime()) / WEEK_MS) : practiceGap;
  let windowEnd = input.resetsOn ?? addMonth(input.today);
  let weeksSinceMock = input.lastMock ? Math.floor((input.today.getTime() - input.lastMock.getTime()) / WEEK_MS) : gap;
  // A mock only after a practice test since the last one.
  // (A first-ever test is a practice test.)
  let practisedSinceMock = !!input.lastPractice && (!input.lastMock || input.lastPractice > input.lastMock);

  const slots: Slot[] = [];
  for (let weeks = 0; at <= end && slots.length < 10 && weeks < 26; weeks++) {
    if (at >= windowEnd) {
      left = perMonth === null ? Infinity : perMonth;
      practiceLeft = practicePerMonth === null ? Infinity : practicePerMonth;
      while (at >= windowEnd) windowEnd = addMonth(windowEnd);
    }
    const due = weeksSinceMock + 1 >= gap && practisedSinceMock;
    if (due && left > 0) {
      slots.push({ date: at, kind: "mock", mockAllowed: true });
      left--;
      weeksSinceMock = 0;
      practisedSinceMock = false;
    } else if (due && left <= 0 && windowEnd <= end && windowEnd.getTime() - at.getTime() < WEEK_MS) {
      // Out of mocks this month and they come back within the week: the mock goes on that day.
      if (practiceLeft > 0) {
        slots.push({ date: at, kind: "practice_test", mockAllowed: false });
        practiceLeft--;
      }
      const resetDay = new Date(windowEnd);
      slots.push({ date: resetDay, kind: "mock", onReset: true, mockAllowed: true });
      left = (perMonth ?? 1) - 1;
      practiceLeft = practicePerMonth === null ? Infinity : practicePerMonth;
      weeksSincePractice = 0;
      windowEnd = addMonth(windowEnd);
      weeksSinceMock = 0;
      practisedSinceMock = false;
      // The week goes on from the mock day.
      at = new Date(resetDay.getTime() + WEEK_MS);
      continue;
    } else if (weeksSincePractice + 1 >= practiceGap && practiceLeft > 0) {
      slots.push({ date: at, kind: "practice_test", mockAllowed: left > 0 });
      practiceLeft--;
      weeksSincePractice = 0;
      weeksSinceMock++;
      practisedSinceMock = true;
    } else {
      // Nothing this week: the plan's tests are spread out.
      weeksSinceMock++;
      weeksSincePractice++;
    }
    at = new Date(at.getTime() + WEEK_MS);
  }

  // With an exam date: the last test before it is a full mock (about a week before).
  if (input.examDate && slots.length) {
    const finalWindow = input.examDate.getTime() - 10 * DAY_MS;
    const lastSlot = slots[slots.length - 1];
    // Only when the allowance has a mock left on that date.
    if (lastSlot.kind !== "mock" && lastSlot.mockAllowed && lastSlot.date.getTime() >= finalWindow) lastSlot.kind = "mock";
  }
  return slots.sort((a, b) => a.date.getTime() - b.date.getTime());
}
