import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/Button";
import { ROUTES } from "@/constants/routes";
import type { ReportAbout, ScoreReport as ScoreReportData, ScoreSkill, ScoreTypeResult } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

// The Spica score's bands (10-90, Spica's own scale aligned to CEFR).
const BANDS = [
  { level: "Pre-A1", min: 10, max: 19 },
  { level: "A1", min: 20, max: 29 },
  { level: "A2", min: 30, max: 39 },
  { level: "B1", min: 40, max: 54 },
  { level: "B2", min: 55, max: 69 },
  { level: "C1", min: 70, max: 79 },
  { level: "C2", min: 80, max: 90 },
];
// Position on the 10-90 scale, as a share of its length.
const at = (score: number) => Math.max(0, Math.min(1, (score - 10) / 80));

const SKILL_COLOR: Record<ScoreSkill, string> = {
  speaking: "var(--color-speaking)",
  listening: "var(--color-listening)",
  reading: "var(--color-reading)",
  writing: "var(--color-writing)",
};
const SKILL_NAME: Record<ScoreSkill, () => string> = {
  speaking: () => tr("Speaking"),
  listening: () => tr("Listening"),
  reading: () => tr("Reading"),
  writing: () => tr("Writing"),
};
const MEASURES: Record<ScoreSkill, () => string> = {
  speaking: () => tr("How clearly and smoothly you speak: repeating and building sentences, answering questions and retelling stories."),
  listening: () => tr("How well you understand spoken English at natural speed: sentences, conversations and short talks."),
  reading: () => tr("How well you understand written English: completing sentences and understanding passages."),
  writing: () => tr("How accurately you write: typing what you hear and rewriting or writing short texts."),
};

// What a learner can do at each level, per skill.
const CAN_DO: Record<ScoreSkill, Record<string, () => string>> = {
  speaking: {
    "Pre-A1": () => tr("Say a few familiar words and very short phrases about yourself."),
    A1: () => tr("Introduce yourself and answer simple questions about familiar things, slowly."),
    A2: () => tr("Talk about your daily routine, work and plans in short, simple sentences."),
    B1: () => tr("Describe experiences and plans in connected sentences that others understand."),
    B2: () => tr("Explain a point of view and take part in work discussions with some fluency."),
    C1: () => tr("Speak fluently on complex topics, with clear structure and little searching for words."),
    C2: () => tr("Speak effortlessly and precisely in any situation, including fine shades of meaning."),
  },
  listening: {
    "Pre-A1": () => tr("Recognise a few familiar words when they're spoken slowly and clearly."),
    A1: () => tr("Understand simple questions and instructions spoken slowly."),
    A2: () => tr("Understand short, clear messages and conversations on familiar topics."),
    B1: () => tr("Follow the main points of clear speech about work and everyday life."),
    B2: () => tr("Follow conversations and talks at natural speed, including some detail."),
    C1: () => tr("Follow extended talk on unfamiliar topics and pick up implied meaning."),
    C2: () => tr("Understand any spoken English with ease, even fast or idiomatic speech."),
  },
  reading: {
    "Pre-A1": () => tr("Recognise familiar names, words and very simple sentences."),
    A1: () => tr("Understand short, simple texts like notices and signs."),
    A2: () => tr("Find information in short everyday texts like emails and timetables."),
    B1: () => tr("Understand the main points of clear texts on familiar topics."),
    B2: () => tr("Read work emails and articles and understand the main points and details."),
    C1: () => tr("Understand long, complex texts and the writer's attitude."),
    C2: () => tr("Read almost any text with ease, including specialised or abstract ones."),
  },
  writing: {
    "Pre-A1": () => tr("Write your name and a few familiar words."),
    A1: () => tr("Write short, simple phrases and fill in forms with personal details."),
    A2: () => tr("Write short, simple notes and messages about everyday needs."),
    B1: () => tr("Write simple connected text on familiar topics, like a short email."),
    B2: () => tr("Write clear, detailed emails and short reports on familiar topics."),
    C1: () => tr("Write well-structured texts on complex topics with good control of grammar."),
    C2: () => tr("Write clear, fluent and precise texts in any style."),
  },
};

// How to improve, by the question type that went least well.
const TIPS: Record<string, () => string> = {
  repeats: () => tr("Practise Repeats: listen to the whole sentence, then say it back at the same pace without stopping."),
  sentence_builds: () => tr("Practise Sentence Builds: put the word groups in order in your head before you start speaking."),
  conversations: () => tr("Practise Conversations: note who says what, and listen for the answer to the question at the end."),
  passage_comprehension: () => tr("Practise Passage Comprehension: listen for the reason or result the question asks about."),
  story_retelling: () => tr("Practise Story Retelling: retell who, what and why in your own words, and keep talking for 30 seconds."),
  short_answer: () => tr("Practise Short Answer: answer in one or two words, quickly and clearly."),
  dictation: () => tr("Practise Dictation: write the whole sentence, then check spelling and small words like a and the."),
  response_selection: () => tr("Practise Response Selection: choose the reply that fits what was said, not just a word you heard."),
  sentence_completion: () => tr("Practise Sentence Completion: read the whole sentence before choosing the missing word."),
  passage_reconstruction: () => tr("Practise Passage Reconstruction: keep the main points and check your tenses and articles."),
  email_writing: () => tr("Practise Email Writing: cover every point in the task, in clear short paragraphs."),
  typing: () => tr("Practise Typing: type accurately first, then build speed."),
  reading: () => tr("Practise Read Aloud: read at a steady pace and pause at commas and full stops."),
  reading_comprehension: () => tr("Practise Reading Comprehension: find the sentence in the text that answers the question."),
  reading_selective: () => tr("Practise Reading (Selective): scan for the key words in the question first."),
  summary_and_opinion: () => tr("Practise Summary & Opinion: summarise the main idea, then give your opinion with a reason."),
  free_writing: () => tr("Practise Free Writing: plan three points before you start writing."),
  open_questions: () => tr("Practise Open Questions: answer with a reason and an example."),
  speaking_situations: () => tr("Practise Speaking Situations: say what you'd say in that situation, politely and clearly."),
};

const PROFILE: Record<string, { label: () => string; sub: () => string; color: string }> = {
  listening: { label: () => tr("Listening"), sub: () => tr("comprehension"), color: SKILL_COLOR.listening },
  reading: { label: () => tr("Reading"), sub: () => tr("comprehension"), color: SKILL_COLOR.reading },
  fluency: { label: () => tr("Fluency"), sub: () => tr("speaking"), color: SKILL_COLOR.speaking },
  pronunciation: { label: () => tr("Pronunciation"), sub: () => tr("speaking"), color: SKILL_COLOR.speaking },
  spokenGrammar: { label: () => tr("Grammar"), sub: () => tr("speaking"), color: SKILL_COLOR.speaking },
  vocabulary: { label: () => tr("Vocabulary"), sub: () => tr("speaking & writing"), color: SKILL_COLOR.speaking },
  writtenGrammar: { label: () => tr("Grammar"), sub: () => tr("writing"), color: SKILL_COLOR.writing },
  spelling: { label: () => tr("Spelling"), sub: () => tr("& punctuation"), color: SKILL_COLOR.writing },
};

function Section({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={`bg-surface border border-rule rounded-card p-5 sm:p-6 flex flex-col gap-4 min-w-0 break-inside-avoid ${className}`}>
      {children}
    </section>
  );
}

function StatusChip({ status, level }: { status: "below" | "meets" | "above" | null; level: string }) {
  const cls = status === "above" ? "text-success" : status === "below" ? "text-error" : "text-navy-deep";
  const text =
    status === "above"
      ? tr("{{level}} · above goal", { level })
      : status === "below"
        ? tr("{{level}} · below goal", { level })
        : status === "meets"
          ? tr("{{level}} · meets goal", { level })
          : level;
  return <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-pill border border-current whitespace-nowrap ${cls}`}>{text}</span>;
}

const typeLine = (t: ScoreTypeResult) => tr("{{type}}: {{right}} of {{total}} right", { type: t.typeName, right: t.right, total: t.total });

// The score report shown at the top of a practice test or mock report, and
// printed (Download PDF) as the learner's score report.
// viewer "org": an Org Admin or Manager reading a learner's report, so it
// speaks about the learner, not to them, and leaves out the learner's summary.
export function ScoreReport({ score, about, analysis, viewer = "learner" }: { score: ScoreReportData; about: ReportAbout | null | undefined; analysis: string; viewer?: "learner" | "org" }) {
  const org = viewer === "org";
  if (!score.overall) return null;
  const date = score.completedAt ? new Date(score.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
  const test = about?.testTypeName ? (about.familyName ? tr("{{family}}-style {{test}}", { family: about.familyName, test: about.testTypeName }) : about.testTypeName) : null;
  const best = [...score.skills].sort((a, b) => b.score - a.score)[0];
  const worst = [...score.skills].sort((a, b) => a.score - b.score)[0];

  return (
    <div className="score-report flex flex-col gap-4">
      {/* Printed (Download PDF): A4 without the browser's date/URL lines, colours kept, the
          report alone in a fixed two-column layout. */}
      <style>{`@media print {
  @page { size: A4; margin: 0; }
  .score-report { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 11mm 12mm; gap: 10px; font-size: 13px; }
  .score-report section { box-shadow: none; padding: 12px 14px; gap: 8px; }
  /* Each printed page after the first starts with its own top margin. */
  .score-report .print-page { break-before: page; padding-top: 11mm; }
}`}</style>
      {/* Page 1: who, the score and the four skills. Page 2: the profile and a card per
          skill. Page 3: speaking and writing in detail. */}
      {/* Header */}
      <Section label={tr("Report details")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="font-logo font-bold text-2xl text-navy">Spica</span>
            <h2 className="font-display font-bold text-2xl text-ink mt-1">{tr("Score report")}</h2>
            {test && (
              <p className="text-sm text-muted">
                {test} · {about?.deliveryMode === "certified" ? tr("Real test") : about?.deliveryMode === "mock" ? tr("Mock test") : tr("Practice test")}
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={() => window.print()} className="print:hidden flex items-center gap-2">
            <Download size={15} /> {tr("Download PDF")}
          </Button>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3 border-t border-rule pt-4 text-sm">
          <div>
            <dd className="font-semibold text-ink">{score.learner.name}</dd>
            <dt className="text-xs text-muted">{tr("Name")}</dt>
          </div>
          <div>
            <dd className="font-semibold text-ink font-mono">{score.learner.learnerId ?? "—"}</dd>
            <dt className="text-xs text-muted">{tr("Learner ID")}</dt>
          </div>
          <div>
            <dd className="font-semibold text-ink">{date}</dd>
            <dt className="text-xs text-muted">{tr("Test date")}</dt>
          </div>
          <div>
            <dd className="font-semibold text-ink font-mono">{score.reportId ?? "—"}</dd>
            <dt className="text-xs text-muted">{tr("Report ID")}</dt>
          </div>
        </dl>
      </Section>

      {/* Overall */}
      <Section label={tr("Overall score")}>
        <div className="grid sm:grid-cols-[200px_1fr] print:grid-cols-[170px_1fr] gap-5 items-center">
          <div className="flex sm:flex-col print:flex-col items-center justify-center gap-2 sm:gap-1 print:gap-1 rounded-card bg-paper-warm p-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{tr("Spica score")}</span>
            <span className="font-display font-bold text-5xl sm:text-6xl text-ink leading-none tabular-nums">{score.overall.score}</span>
            <span className="text-xs text-muted">{tr("out of 90")}</span>
            <span className="font-display font-bold text-xl text-navy-deep">{tr("CEFR {{level}}", { level: score.overall.level })}</span>
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            {analysis && !org && <p className="text-sm text-ink leading-relaxed">{analysis}</p>}
            <div>
              <div className="relative grid h-8 rounded-lg overflow-hidden" style={{ gridTemplateColumns: BANDS.map((b) => `${b.max - b.min + 1}fr`).join(" ") }}>
                {BANDS.map((b, i) => (
                  <div
                    key={b.level}
                    className={`flex items-center justify-center text-[11px] font-semibold ${b.level === score.overall!.level ? "bg-navy text-white" : i % 2 ? "bg-paper-warm text-muted" : "bg-paper text-muted"}`}
                  >
                    {b.level}
                  </div>
                ))}
              </div>
              {/* Where the score sits in its band: a pointer under the bar, not a line over the band's name. */}
              <div className="relative h-5 mt-0.5" aria-hidden="true">
                <span
                  className="absolute -translate-x-1/2 flex flex-col items-center text-[11px] font-semibold text-ink leading-none"
                  style={{ left: `${at(score.overall.score) * 100}%` }}
                >
                  <span className="text-navy-deep">▲</span>
                  {score.overall.score}
                </span>
              </div>
              <div className="relative h-4 text-[11px] text-muted font-mono mt-1" aria-hidden="true">
                {[10, 20, 30, 40, 55, 70, 80, 90].map((n) => (
                  <span key={n} className={`absolute ${n === 10 ? "" : n === 90 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${at(n) * 100}%` }}>
                    {n}
                  </span>
                ))}
              </div>
            </div>
            {score.goal && (
              <p className="text-sm text-muted">
                {org ? tr("Goal: {{level}}.", { level: score.goal }) : tr("Your goal: {{level}}.", { level: score.goal })}{" "}
                {score.skills.filter((s) => s.status === "below").length
                  ? tr("Still below it: {{skills}}.", { skills: score.skills.filter((s) => s.status === "below").map((s) => SKILL_NAME[s.skill]()).join(", ") })
                  : tr("Every skill has reached it.")}
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* Four skills */}
      <Section label={org ? tr("Skills") : tr("Your skills")}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display font-bold text-lg text-ink">{org ? (score.skills.length === 4 ? tr("The four skills") : tr("Skills")) : score.skills.length === 4 ? tr("Your four skills") : tr("Your skills")}</h3>
          <span className="text-xs text-muted">{org
            ? score.goal
              ? tr("Bars show the Spica score; the line is the goal ({{level}}).", { level: score.goal })
              : tr("Bars show the Spica score.")
            : score.goal
              ? tr("Bars show your Spica score; the line is your goal ({{level}}).", { level: score.goal })
              : tr("Bars show your Spica score.")}</span>
        </div>
        <SkillBars score={score} />
      </Section>

      <div className="print-page flex flex-col gap-4 print:gap-2.5">
      {/* Skill profile */}
      <ProfileChart score={score} org={org} />

      {/* Skill by skill */}
      <div className="grid md:grid-cols-2 print:grid-cols-2 gap-4 print:gap-2.5">
        {score.skills.map((s) => {
          // The question type that went least well; none when every type went well.
          const tip = s.focus[0] ?? null;
          return (
            <Section key={s.skill} label={SKILL_NAME[s.skill]()}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-display font-bold text-lg text-ink">{SKILL_NAME[s.skill]()}</h3>
                <span className="font-display font-bold text-xl tabular-nums" style={{ color: SKILL_COLOR[s.skill] }}>
                  {s.level} · {s.score}
                </span>
              </div>
              <span className="h-1 -mt-2 rounded-pill" style={{ background: SKILL_COLOR[s.skill] }} aria-hidden="true" />
              <Fact title={tr("What it measures")}>{MEASURES[s.skill]()}</Fact>
              {CAN_DO[s.skill][s.level] && <Fact title={tr("At {{level}} you can", { level: s.level })}>{CAN_DO[s.skill][s.level]()}</Fact>}
              {s.strengths.length > 0 && (
                <Fact title={tr("Strengths")}>
                  <ul className="list-disc pl-5">{s.strengths.map((t) => <li key={t.itemTypeId}>{typeLine(t)}</li>)}</ul>
                </Fact>
              )}
              {s.focus.length > 0 && (
                <Fact title={tr("Focus areas")}>
                  <ul className="list-disc pl-5">{s.focus.map((t) => <li key={t.itemTypeId}>{typeLine(t)}</li>)}</ul>
                </Fact>
              )}
              <Fact title={tr("How to improve")}>
                {tip && TIPS[tip.itemTypeId] ? TIPS[tip.itemTypeId]() : tr("This went well. Keep it strong with sets at the next level up.")}
              </Fact>
              <Link
                to={`${ROUTES.MODULES}?pSkill=${s.skill}${tip ? `&pType=${encodeURIComponent(tip.itemTypeId)}` : ""}`}
                className="text-sm font-semibold text-navy-deep hover:underline print:hidden"
              >
                {tr("Practise {{skill}}", { skill: SKILL_NAME[s.skill]().toLowerCase() })} →
              </Link>
            </Section>
          );
        })}
      </div>

      </div>

      {(score.speaking || score.writing) && (
        <div className="print-page flex flex-col gap-4 print:gap-2.5">
          {score.speaking && <SpeakingDetail s={score.speaking} />}
          {score.writing && <WritingDetail w={score.writing} />}
        </div>
      )}

      {best && worst && best.skill !== worst.skill && (
        <p className="text-sm text-muted">
          {org
            ? tr("Strongest skill: {{best}}. The skill that will lift the score most: {{worst}}.", { best: SKILL_NAME[best.skill](), worst: SKILL_NAME[worst.skill]() })
            : tr("Strongest skill: {{best}}. The skill that will lift your score most: {{worst}}.", { best: SKILL_NAME[best.skill](), worst: SKILL_NAME[worst.skill]() })}
        </p>
      )}
      <p className="text-xs text-muted">
        {tr("The Spica score (10–90) is Spica's own scale, aligned to CEFR levels: Pre-A1 10–19, A1 20–29, A2 30–39, B1 40–54, B2 55–69, C1 70–79, C2 80–90. It is a practice result, not an official exam score.")}
      </p>
    </div>
  );
}

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm text-ink">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</span>
      <div>{children}</div>
    </div>
  );
}

// Four bars on the 10-90 scale, against the CEFR bands, with the goal line.
function SkillBars({ score }: { score: ScoreReportData }) {
  const H = 240;
  const goalBand = BANDS.find((b) => b.level === score.goal);
  const edges = [20, 30, 40, 55, 70, 80];
  return (
    <div>
      <div className="grid gap-x-3" style={{ gridTemplateColumns: `44px repeat(${score.skills.length}, minmax(0, 1fr))` }}>
        <div className="relative text-[11px] font-semibold text-muted" style={{ height: H }}>
          {BANDS.map((b) => (
            <span key={b.level} className="absolute right-1 translate-y-1/2 whitespace-nowrap" style={{ bottom: `${at((b.min + b.max) / 2) * 100}%` }}>
              {b.level}
            </span>
          ))}
        </div>
        {score.skills.map((s) => (
          <div key={s.skill} className="relative rounded-lg bg-paper" style={{ height: H }}>
            {edges.map((e) => (
              <span key={e} className="absolute inset-x-0 border-t border-dashed border-rule-strong" style={{ bottom: `${at(e) * 100}%` }} aria-hidden="true" />
            ))}
            <div className="absolute left-[22%] right-[22%] bottom-0 rounded-t-lg rounded-b-sm" style={{ height: `${at(s.score) * 100}%`, background: SKILL_COLOR[s.skill] }}>
              <b className="absolute -top-6 inset-x-0 text-center font-display text-base text-ink tabular-nums">{s.score}</b>
            </div>
            {goalBand && <span className="absolute inset-x-0 border-t-2 border-ink" style={{ bottom: `${at(goalBand.min) * 100}%` }} aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="grid gap-x-3 mt-2 text-center text-sm" style={{ gridTemplateColumns: `44px repeat(${score.skills.length}, minmax(0, 1fr))` }}>
        <span />
        {score.skills.map((s) => (
          <div key={s.skill} className="flex flex-col items-center gap-1">
            <b className="text-ink">{SKILL_NAME[s.skill]()}</b>
            <StatusChip status={s.status} level={s.level} />
          </div>
        ))}
      </div>
    </div>
  );
}

// The eight-part profile (each out of 100) as a spider chart; parts without data are left out.
function ProfileChart({ score, org = false }: { score: ScoreReportData; org?: boolean }) {
  const parts = score.profile.filter((p): p is { key: string; value: number } => p.value !== null && !!PROFILE[p.key]);
  if (parts.length < 3) return null;
  const cx = 220;
  const cy = 200;
  const R = 140;
  const n = parts.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + ((R * v) / 100) * Math.cos(a), cy + ((R * v) / 100) * Math.sin(a)] as const;
  };
  const ring = (v: number) => parts.map((_, i) => pt(i, v).join(",")).join(" ");
  const sorted = [...parts].sort((a, b) => b.value - a.value);
  const name = (k: string) => `${PROFILE[k].label()} (${PROFILE[k].sub()})`;
  return (
    <Section label={org ? tr("Skill profile") : tr("Your skill profile")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display font-bold text-lg text-ink">{org ? tr("Skill profile") : tr("Your skill profile")}</h3>
        <span className="text-xs text-muted">{org ? tr("Each part of the learner's English out of 100. The further out, the stronger.") : tr("Each part of your English out of 100. The further out, the stronger.")}</span>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_220px] print:grid-cols-[minmax(0,1fr)_200px] gap-5 items-center">
        <svg viewBox="-50 0 540 410" className="w-full max-w-[520px] print:max-w-[340px] h-auto mx-auto" role="img" aria-label={parts.map((p) => `${name(p.key)} ${p.value}`).join(", ")}>
          {[25, 50, 75, 100].map((v) => (
            <g key={v}>
              <polygon points={ring(v)} fill="none" stroke="var(--color-rule-strong)" strokeWidth={1} />
              <text x={pt(0, v)[0] + 4} y={pt(0, v)[1] + 4} fontSize={10} fill="var(--color-muted)" fontFamily="var(--font-mono)">
                {v}
              </text>
            </g>
          ))}
          {parts.map((_, i) => (
            <line key={i} x1={cx} y1={cy} x2={pt(i, 100)[0]} y2={pt(i, 100)[1]} stroke="var(--color-rule)" strokeWidth={1} />
          ))}
          <polygon points={parts.map((p, i) => pt(i, p.value).join(",")).join(" ")} fill="color-mix(in srgb, var(--color-navy) 22%, transparent)" stroke="var(--color-navy)" strokeWidth={2.5} strokeLinejoin="round" />
          {parts.map((p, i) => (
            <circle key={p.key} cx={pt(i, p.value)[0]} cy={pt(i, p.value)[1]} r={4.5} fill={PROFILE[p.key].color} stroke="var(--color-surface)" strokeWidth={1.5} />
          ))}
          {parts.map((p, i) => {
            const [x, y] = pt(i, 122);
            const anchor = Math.abs(x - cx) < 20 ? "middle" : x > cx ? "start" : "end";
            const dy = y < cy - 100 ? -6 : y > cy + 100 ? 10 : 0;
            return (
              <g key={p.key}>
                <text x={x} y={y + dy} textAnchor={anchor} fontSize={12.5} fontWeight={600} fill="var(--color-ink)" fontFamily="var(--font-body)">
                  {PROFILE[p.key].label()}{" "}
                  <tspan fill={PROFILE[p.key].color} fontFamily="var(--font-display)">
                    {p.value}
                  </tspan>
                </text>
                <text x={x} y={y + dy + 14} textAnchor={anchor} fontSize={10.5} fill="var(--color-muted)" fontFamily="var(--font-body)">
                  {PROFILE[p.key].sub()}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="flex flex-col gap-1 text-sm text-ink">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{tr("Strongest")}</span>
          <p>{sorted.slice(0, 2).map((p) => `${name(p.key)} ${p.value}`).join(" · ")}</p>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted mt-2">{tr("Work on")}</span>
          <p>{sorted.slice(-2).reverse().map((p) => `${name(p.key)} ${p.value}`).join(" · ")}</p>
          <p className="text-xs text-muted mt-2">{tr("Listening and Reading show the share of questions you got right; the rest come from your spoken and written answers.")}</p>
        </div>
      </div>
    </Section>
  );
}

function Metric({ title, value, note, color }: { title: string; value: number; note: string; color: string }) {
  return (
    <div className="border border-rule rounded-input p-3.5 flex flex-col gap-2">
      <div className="flex justify-between items-baseline gap-2">
        <b className="text-sm text-ink">{title}</b>
        <span className="font-display font-semibold text-lg text-ink tabular-nums">{value}/100</span>
      </div>
      <div className="h-2 rounded-pill bg-paper-warm overflow-hidden">
        <i className="block h-full rounded-pill" style={{ width: `${value}%`, background: color }} />
      </div>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

export function SpeakingDetail({ s }: { s: NonNullable<ScoreReportData["speaking"]> }) {
  const c = SKILL_COLOR.speaking;
  const facts = [
    s.wordsPerMinute !== null ? tr("{{n}} words a minute", { n: s.wordsPerMinute }) : null,
    s.fillers !== null ? (s.fillers === 1 ? tr("1 filler (“um”, “uh”)") : tr("{{n}} fillers (“um”, “uh”)", { n: s.fillers })) : null,
  ].filter(Boolean);
  return (
    <Section label={tr("Speaking in detail")}>
      <div>
        <h3 className="font-display font-bold text-lg text-ink">{tr("Speaking in detail")}</h3>
        {s.answers > 0 && (
          <p className="text-xs text-muted">
            {s.answers === 1 ? tr("From your 1 spoken answer.") : tr("From your {{n}} spoken answers.", { n: s.answers })} {tr("Scored on how clearly you're understood, never on your accent.")}
          </p>
        )}
      </div>
      {s.silent > 0 && (
        <p className="text-sm text-warning bg-warning/10 rounded-input px-3 py-2">
          {s.silent === 1
            ? tr("We couldn't hear any speech in 1 recording, so it isn't counted here. Check your microphone before the next set.")
            : tr("We couldn't hear any speech in {{n}} recordings, so they aren't counted here. Check your microphone before the next set.", { n: s.silent })}
        </p>
      )}
      <div className="grid sm:grid-cols-2 print:grid-cols-2 gap-3">
        {s.fluency !== null && <Metric title={tr("Fluency")} value={s.fluency} color={c} note={facts.length ? facts.join(" · ") : tr("How smoothly you keep talking.")} />}
        {s.clarity !== null && <Metric title={tr("Pronunciation & clarity")} value={s.clarity} color={c} note={tr("How easily your words were understood.")} />}
        {s.grammar !== null && <Metric title={tr("Grammar")} value={s.grammar} color={c} note={tr("From Sentence Builds: putting words in the right order.")} />}
        {s.vocabulary !== null && <Metric title={tr("Vocabulary")} value={s.vocabulary} color={c} note={tr("From Short Answer and Sentence Completion.")} />}
      </div>
      {s.example && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{tr("Example · {{type}}, what we heard", { type: s.example.typeName })}</span>
          <p className="text-sm text-ink border-l-[3px] border-rule-strong bg-paper/60 rounded-r-input px-3 py-2">“{s.example.transcript}”</p>
          {s.example.comment && <p className="text-xs text-muted">{s.example.comment}</p>}
        </div>
      )}
    </Section>
  );
}

export function WritingDetail({ w }: { w: NonNullable<ScoreReportData["writing"]> }) {
  const c = SKILL_COLOR.writing;
  const count = (k: string) => w.errors[k] ?? 0;
  return (
    <Section label={tr("Writing in detail")}>
      <div>
        <h3 className="font-display font-bold text-lg text-ink">{tr("Writing in detail")}</h3>
        <p className="text-xs text-muted">{w.answers === 1 ? tr("From your 1 written answer.") : tr("From your {{n}} written answers.", { n: w.answers })}</p>
      </div>
      <div className="grid sm:grid-cols-2 print:grid-cols-2 gap-3">
        {w.grammar !== null && (
          <Metric
            title={tr("Grammar")}
            value={w.grammar}
            color={c}
            note={!w.marked ? tr("From how well your written answers were scored.") : count("grammar") === 1 ? tr("1 grammar error.") : tr("{{n}} grammar errors.", { n: count("grammar") })}
          />
        )}
        {w.vocabulary !== null && <Metric title={tr("Vocabulary")} value={w.vocabulary} color={c} note={count("vocabulary") === 1 ? tr("1 word choice to improve.") : tr("{{n}} word choices to improve.", { n: count("vocabulary") })} />}
        {w.spelling !== null && (
          <Metric
            title={tr("Spelling & punctuation")}
            value={w.spelling}
            color={c}
            note={w.marked ? tr("{{s}} spelling, {{p}} punctuation errors.", { s: count("spelling"), p: count("punctuation") }) : tr("From your Dictation answers, word by word.")}
          />
        )}
        {w.task !== null && <Metric title={tr("Task & content")} value={w.task} color={c} note={tr("How fully your answers covered the task.")} />}
      </div>
      {w.example && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{tr("Example")}</span>
          <p className="text-sm text-ink">
            <mark className="bg-error/15 text-ink rounded px-1">{w.example.text}</mark> → <ins className="no-underline bg-success/15 rounded px-1">{w.example.correction}</ins>
          </p>
          <p className="text-xs text-muted">{w.example.reason}</p>
        </div>
      )}
    </Section>
  );
}
