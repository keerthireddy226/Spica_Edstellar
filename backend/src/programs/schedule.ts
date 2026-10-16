// A program member's plan: when to take a practice test and when a mock exam,
// from the time left and the gap to the target (ASSESSMENT_ENGINE.md
// section 8). Pure, so it's easy to test; programs/service.ts stores it.
import { CEFR_LEVELS, type CefrLevel } from "../placement/cefr.js";

export interface ScheduleInput {
  // First day that can hold an item (today, or the program's start).
  from: string;
  targetDate: string;
  // Target minus current level, in CEFR steps; null when the level isn't known yet.
  gap: number | null;
  practicePerMonth: number | null;
  mocksPerMonth: number | null;
  // Limits count per license month from this day (YYYY-MM-DD); calendar months without it.
  monthStart?: string;
}

export interface PlannedItem {
  dueOn: string;
  kind: "practice" | "mock";
}

const DAY = 86_400_000;

function toDate(s: string): number {
  return Date.parse(`${s}T00:00:00Z`);
}

function toIso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

// The month a day falls in: the calendar month, or the number of whole
// months since `start` (license months: 20 Oct - 19 Nov is month 0).
function monthKey(s: string, start?: string): string {
  if (!start) return s.slice(0, 7);
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = s.split("-").map(Number);
  return String((y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

// Days between practice tests and between mock exams: a bigger gap means
// more often. The design's range is a mock every 2-4 weeks.
export function intervals(gap: number | null): { practiceDays: number; mockDays: number } {
  const g = gap ?? 2;
  if (g >= 2) return { practiceDays: 3, mockDays: 14 };
  if (g === 1) return { practiceDays: 4, mockDays: 21 };
  return { practiceDays: 7, mockDays: 28 };
}

export function levelGap(target: string, current: string | null | undefined): number | null {
  if (!current) return null;
  const t = CEFR_LEVELS.indexOf(target as CefrLevel);
  const c = CEFR_LEVELS.indexOf(current as CefrLevel);
  if (t < 0 || c < 0) return null;
  return Math.max(0, t - c);
}

// Keeps at most `limit` items per calendar month, spread across the month's
// dates. Items with priority (the final mock, a first mock) are kept first.
function capPerMonth(items: (PlannedItem & { priority?: boolean })[], limit: number | null, start?: string): PlannedItem[] {
  if (limit === null) return items.map(({ dueOn, kind }) => ({ dueOn, kind }));
  const byMonth = new Map<string, (PlannedItem & { priority?: boolean })[]>();
  for (const it of items) byMonth.set(monthKey(it.dueOn, start), [...(byMonth.get(monthKey(it.dueOn, start)) ?? []), it]);
  const kept: PlannedItem[] = [];
  for (const list of byMonth.values()) {
    const priority = list.filter((x) => x.priority).slice(0, limit);
    const rest = list.filter((x) => !x.priority);
    const room = limit - priority.length;
    const spread = room <= 0 ? [] : rest.length <= room ? rest : Array.from({ length: room }, (_, i) => rest[Math.floor((i * rest.length) / room)]);
    kept.push(...[...priority, ...spread].map(({ dueOn, kind }) => ({ dueOn, kind })));
  }
  return kept;
}

export function buildSchedule(input: ScheduleInput): PlannedItem[] {
  const start = toDate(input.from);
  const end = toDate(input.targetDate);
  if (!(end > start)) return [];
  const { practiceDays, mockDays } = intervals(input.gap);

  // Mocks: a first one within 3 days when the level isn't known (a
  // baseline), then every mockDays, and a final one 3 days before the target.
  const mocks: (PlannedItem & { priority?: boolean })[] = [];
  let first = start + mockDays * DAY;
  if (input.gap === null) {
    first = start + Math.min(3, Math.floor((end - start) / DAY / 2)) * DAY;
    mocks.push({ dueOn: toIso(first), kind: "mock", priority: true });
    first += mockDays * DAY;
  }
  // Regular mocks stop a week before the final one.
  const final = end - 3 * DAY;
  for (let t = first; t < final - 7 * DAY; t += mockDays * DAY) mocks.push({ dueOn: toIso(t), kind: "mock" });
  const lastMock = mocks.length ? toDate(mocks[mocks.length - 1].dueOn) : -Infinity;
  if (final > start && final > lastMock) mocks.push({ dueOn: toIso(final), kind: "mock", priority: true });

  const keptMocks = capPerMonth(mocks, input.mocksPerMonth, input.monthStart);
  const mockDates = new Set(keptMocks.map((m) => m.dueOn));

  // Practice: every practiceDays, never on a mock day.
  const practice: PlannedItem[] = [];
  for (let t = start + practiceDays * DAY; t < end; t += practiceDays * DAY) {
    const d = toIso(t);
    if (!mockDates.has(d)) practice.push({ dueOn: d, kind: "practice" });
  }
  const keptPractice = capPerMonth(practice, input.practicePerMonth, input.monthStart);

  return [...keptMocks, ...keptPractice].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.kind.localeCompare(b.kind));
}

// The biggest gap: overall, or any skill with its own target. null while the
// overall level isn't known.
export function programGap(
  p: { target_level: string; target_skills: Record<string, string> | null },
  level: { overall: string | null; skills: Record<string, string> | null },
): number | null {
  const overall = levelGap(p.target_level, level.overall);
  if (overall === null) return null;
  let gap = overall;
  for (const [skill, target] of Object.entries(p.target_skills ?? {})) {
    const g = levelGap(target, level.skills?.[skill]);
    if (g !== null) gap = Math.max(gap, g);
  }
  return gap;
}
