// The test plan's dates (practice tests, mock tests, the exam day) as
// calendar events: an .ics file for Apple Calendar and Outlook, and one
// "Add to Google Calendar" link per date, emailed when the plan is created
// and whenever the learner asks. Each event keeps the same UID, so sending the
// dates again moves the events instead of adding copies.
import { pool } from "../db.js";
import { APP_URL, sendCalendarEmail } from "../auth/mailer.js";
import { dateOnly } from "../lib/dateOnly.js";
import { languageForEmail, translateServerText } from "../i18n/translate.js";
import { journey } from "./journey.js";

export interface PlanEvent {
  date: string;
  kind: "practice_test" | "mock" | "exam";
  uid: string;
}

const TITLES: Record<PlanEvent["kind"], string> = {
  practice_test: "Spica: practice test",
  mock: "Spica: mock test",
  exam: "Your exam day",
};

const LINKS: Record<PlanEvent["kind"], string> = {
  practice_test: "/practice-tests",
  mock: "/mock-exams",
  exam: "/roadmap",
};

export async function planEvents(userId: string): Promise<PlanEvent[]> {
  const today = dateOnly(new Date());
  const j = await journey(userId);
  const count: Record<string, number> = {};
  return j.checkpoints
    .filter((c): c is typeof c & { kind: PlanEvent["kind"] } => (c.kind === "practice_test" || c.kind === "mock" || c.kind === "exam") && !c.done && c.date >= today)
    .map((c) => {
      count[c.kind] = (count[c.kind] ?? 0) + 1;
      return { date: c.date, kind: c.kind, uid: `${userId}-${c.kind}-${count[c.kind]}@spica` };
    });
}

const compact = (d: string) => d.replaceAll("-", "");
const nextDay = (d: string) => {
  const n = new Date(`${d}T00:00:00Z`);
  n.setUTCDate(n.getUTCDate() + 1);
  return n.toISOString().slice(0, 10);
};
const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

// All-day events, with a reminder at 9:00 the day before. Titles in the
// learner's language when given one.
export function buildIcs(events: PlanEvent[], now = new Date(), lang?: string): string {
  const title = (k: PlanEvent["kind"]) => translateServerText(lang, TITLES[k]);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const sequence = Math.floor(now.getTime() / 1000);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Spica//Test plan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Spica test plan"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `SEQUENCE:${sequence}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`,
      `SUMMARY:${escapeText(title(e.kind))}`,
      `DESCRIPTION:${escapeText(`Open Spica: ${APP_URL}${LINKS[e.kind]}`)}`,
      `URL:${APP_URL}${LINKS[e.kind]}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(title(e.kind))}`,
      "TRIGGER:-PT15H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function googleLink(e: PlanEvent, lang?: string): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: translateServerText(lang, TITLES[e.kind]),
    dates: `${compact(e.date)}/${compact(nextDay(e.date))}`,
    details: `Open Spica: ${APP_URL}${LINKS[e.kind]}`,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

const pretty = (d: string, lang: string) => {
  const opts = { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as const;
  const at = new Date(`${d}T00:00:00Z`);
  try {
    return at.toLocaleDateString(lang === "en" ? "en-GB" : lang, opts);
  } catch {
    return at.toLocaleDateString("en-GB", opts);
  }
};

// Each line is a whole sentence, translated on its own into the learner's language.
const KIND_NAMES: Record<PlanEvent["kind"], string> = { practice_test: "Practice test", mock: "Mock test", exam: "Your exam day" };

// Sends the plan's dates; returns how many were sent (0: nothing planned).
export async function emailTestDates(userId: string): Promise<number> {
  const u = (await pool.query(`SELECT email, first_name FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId])).rows[0];
  if (!u?.email) return 0;
  const events = await planEvents(userId);
  if (!events.length) return 0;
  const lang = await languageForEmail(u.email).catch(() => "en");
  const t = (s: string) => translateServerText(lang, s);
  const list = events
    .map((e) => `• ${pretty(e.date, lang)}: ${t(KIND_NAMES[e.kind])}\n  ${t(`Add to Google Calendar: ${googleLink(e, lang)}`)}`)
    .join("\n\n");
  const text = [
    u.first_name ? t(`Hi ${u.first_name},`) : t("Hi,"),
    "",
    t("Here are the test dates in your Spica plan. Add them to your calendar so you don't miss one."),
    "",
    list,
    "",
    t("Apple Calendar or Outlook: open the attached spica-test-plan.ics to add them all at once."),
    "",
    t(`If your plan changes, send the new dates from My journey: ${APP_URL}/roadmap`),
  ].join("\n");
  await sendCalendarEmail({ to: u.email, subject: t("Your test dates for your calendar"), text, ics: buildIcs(events, new Date(), lang) });
  await pool.query(`UPDATE participant_profiles SET test_dates_emailed_at = now() WHERE user_id = $1`, [userId]);
  return events.length;
}
