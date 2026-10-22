import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { useTranslation } from "react-i18next";
import { lockedByServer } from "@/components/licenses/LicenseGate";
import {
  Volume2,
  Mic,
  CheckCircle2,
  ArrowLeft,
  Clock,
  Headphones,
  BookOpen,
  PenLine,
  ChevronRight,
  MessagesSquare,
  Keyboard,
  BookOpenCheck,
  ScanText,
  Repeat2,
  ListChecks,
  Blocks,
  HelpCircle,
  BookMarked,
  MessageCircleQuestion,
  Mic2,
  BookOpenText,
  Drama,
  FileText,
  PenSquare,
  Type,
  Mail,
  Puzzle,
  Layers,
  Sparkles,
  Target,
  Trophy,
  GraduationCap,
  VolumeX,
  CircleDot,
  Lightbulb,
  EyeOff,
  Flame,
  Award,
} from "lucide-react";
import { LearnerHero, SKILL_COLOR } from "@/components/learner/LearnerHero";
import { ROUTES } from "@/constants/routes";
import { Button } from "@/components/Button";
import { ProgressRing } from "@/components/ProgressRing";
import { SKILL_TINT_CLASSES, SKILL_RING_COLOR } from "@/lib/skillTints";
import {
  getAvailability,
  getTypeProgress,
  testsLine,
  getUnits,
  getSets,
  startPracticeSession,
  getCurrentPracticeSession,
  getPracticeSession,
  submitPracticeAttempt,
  completePracticeSession,
  nextCheckQuestion,
  getModuleFeedback,
  type PracticeSummary,
  type PracticeContext,
  type TypeProgress,
  type SkillAvailability,
  type PracticeUnit,
  type PracticeSet,
} from "@/api/practiceSession";
import type { TestItem, SkillTag } from "@/api/testSession";
import { useVoiceRecorder, blobToBase64 } from "@/hooks/useVoiceRecorder";
import { NO_RECORDING_TEXT, playSpokenAudio, stopSpokenAudio } from "@/lib/playSpokenAudio";
import { getFaceEnrollmentStatus } from "@/api/faceCheck";
import { FaceCheck } from "@/components/FaceCheck";
import { TestConsent } from "@/components/pretest/TestConsent";
import { usePeriodicFaceCheck } from "@/hooks/usePeriodicFaceCheck";
import { AnswerInputControl } from "@/components/AnswerInputControl";
import {
  AUDIO_FIRST_TYPES,
  SKILL_BADGE_CLASS,
  ITEM_TYPE_META,
  getSpokenSegments,
  getVisibleText,
  getPassageAndQuestion,
} from "@/lib/testItemDisplay";

import { tr } from "@/i18n/tr";
import { QuestionReview } from "@/components/report/FeedbackReportView";
import { SpeakingDetail, WritingDetail } from "@/components/report/ScoreReport";
import { ModuleGuide } from "@/components/practice/ModuleGuide";
import { beep, loadMuted, saveMuted } from "@/lib/countdownBeep";
import { Confetti } from "@/components/Confetti";
import { MyPath } from "@/components/practice/MyPath";
import { markChecked, resumeNeedsFullCheck, type QuickCheckProblem } from "@/lib/smartResume";
import { AnswerFeedback } from "@/components/AnswerFeedback";
import { useSmallScreen } from "@/lib/device";
import type { PracticeFeedback } from "@/api/practiceTests";
// Fallback reading time for a two-phase item with no server-set duration.
const DEFAULT_TWO_PHASE_READ_SECONDS = 30;

const SKILL_ICONS: Record<SkillTag, typeof Headphones> = {
  listening: Headphones,
  speaking: Mic,
  reading: BookOpen,
  writing: PenLine,
};

const SKILL_EMOJI: Record<SkillTag, string> = {
  listening: "🎧",
  speaking: "🗣️",
  reading: "📖",
  writing: "✍️",
};

// Spelled out per skill rather than derived from ITEM_TYPE_META.skills — that doesn't always match item_types.skills in the DB (e.g. open_questions is speaking-only there).
const SKILL_TYPES: Record<SkillTag, string[]> = {
  listening: [
    "conversations",
    "dictation",
    "passage_comprehension",
    "reading_selective",
    "repeats",
    "response_selection",
    "sentence_builds",
    "short_answer",
    "story_retelling",
  ],
  speaking: [
    "conversations",
    "open_questions",
    "passage_comprehension",
    "reading",
    "reading_selective",
    "repeats",
    "sentence_builds",
    "short_answer",
    "speaking_situations",
    "story_retelling",
  ],
  reading: ["passage_reconstruction", "reading", "reading_comprehension", "reading_selective", "speaking_situations", "summary_and_opinion"],
  // free_writing exists in the DB's item_types but has no ITEM_TYPE_META
  // entry and zero approved content — left out until it's actually usable.
  writing: ["dictation", "email_writing", "passage_reconstruction", "sentence_completion", "summary_and_opinion", "typing"],
};

// A distinct icon per question type — reusing one skill-level icon for all
// of a skill's types (the old design) made every card in a page look the same.
const ITEM_TYPE_ICON: Record<string, typeof Headphones> = {
  reading: Mic2,
  repeats: Repeat2,
  sentence_builds: Blocks,
  conversations: MessagesSquare,
  reading_selective: ScanText,
  short_answer: HelpCircle,
  passage_comprehension: BookOpenCheck,
  speaking_situations: Drama,
  story_retelling: BookMarked,
  open_questions: MessageCircleQuestion,
  dictation: Keyboard,
  response_selection: ListChecks,
  passage_reconstruction: Puzzle,
  summary_and_opinion: FileText,
  reading_comprehension: BookOpenText,
  sentence_completion: PenSquare,
  typing: Type,
  email_writing: Mail,
};

// Rotated by index so a skill's type cards each get a distinct accent
// instead of all sharing one flat skill-level tint. Kept as parallel arrays
// (not derived from one string) since the icon badge needs the soft 15%
// tint but the top accent strip needs the solid color.
const CARD_TINT_ROTATION = [
  "bg-navy/15 text-navy-deep",
  "bg-accent/15 text-accent",
  "bg-warning/20 text-navy-deep",
  "bg-speaking/15 text-speaking",
  "bg-reading/15 text-reading",
  "bg-writing/15 text-writing",
  "bg-listening/15 text-listening",
];
const CARD_STRIP_ROTATION = ["bg-navy", "bg-accent", "bg-warning", "bg-speaking", "bg-reading", "bg-writing", "bg-listening"];

// Very faint full-card tint behind the running session — distinct from
// SKILL_TINT_CLASSES (which is a stronger badge/icon tint), layered over
// bg-surface rather than replacing it (keeps dark-mode elevation correct).
const SKILL_WASH_CLASSES: Record<SkillTag, string> = {
  listening: "bg-listening/[0.05]",
  speaking: "bg-speaking/[0.05]",
  reading: "bg-reading/[0.05]",
  writing: "bg-writing/[0.05]",
};

// Colors the CEFR code in a unit name ("A1 - Beginner") as a difficulty ramp, reusing existing per-skill color tokens.
const CEFR_TINT_CLASSES: Record<string, string> = {
  A1: "bg-listening/15 text-listening",
  A2: "bg-reading/15 text-reading",
  B1: "bg-speaking/15 text-speaking",
  B2: "bg-speaking/25 text-navy-deep",
  C1: "bg-writing/20 text-writing",
  C2: "bg-writing/30 text-navy-deep",
};

function cefrTint(unitName: string): string {
  const code = unitName.match(/^[ABC][12]/)?.[0];
  return (code && CEFR_TINT_CLASSES[code]) || "bg-paper text-navy-deep";
}

// A little growth motif (sprout -> tree) matching the difficulty ramp above.
const CEFR_EMOJI: Record<string, string> = {
  A1: "🥉",
  A2: "🥈",
  B1: "🥇",
  B2: "🥇",
  C1: "💎",
  C2: "💎",
};

function cefrEmoji(unitName: string): string {
  const code = unitName.match(/^[ABC][12]/)?.[0];
  return (code && CEFR_EMOJI[code]) || "📘";
}

interface CachedAnswer {
  responseText: string;
  audioBase64?: string;
  audioMimeType?: string;
  audioBlobUrl?: string;
  durationMs?: number;
}

function SkillPicker({
  availability,
  loading,
  starting,
  onStart,
}: {
  availability: SkillAvailability[] | null;
  loading: boolean;
  starting: boolean;
  onStart: (skill: SkillTag) => void;
}) {
  const { t } = useTranslation();

  const all = availability ?? [];
  const total = all.reduce((n, a) => n + a.total, 0);
  const left = all.reduce((n, a) => n + a.remaining, 0);

  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        eyebrow={tr("One skill at a time")}
        title={t("modules.title")}
        subtitle={t("modules.subtitle")}
        icon={Layers}
        stats={
          all.length
            ? [
                { label: tr("Questions practised"), value: total - left, icon: CheckCircle2 },
                { label: tr("Still to try"), value: left, icon: Sparkles },
                { label: tr("Overall complete"), value: `${total ? Math.round(((total - left) / total) * 100) : 0}%`, icon: Target },
                { label: tr("Skills finished"), value: `${all.filter((a) => a.remaining === 0).length}/${all.length}`, icon: Trophy },
              ]
            : undefined
        }
      />

      {loading ? (
        <p className="text-sm text-muted">{t("modules.loadingAvailability")}</p>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {all.map(({ skill, remaining, total }) => {
            const exhausted = remaining === 0;
            const percent = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0;
            const color = SKILL_COLOR[skill];
            return (
              <button
                key={skill}
                onClick={() => !exhausted && onStart(skill)}
                disabled={starting || exhausted}
                className="group text-left flex flex-col bg-surface border border-rule rounded-card overflow-hidden shadow-sm transition-all cursor-pointer hover:-translate-y-1 hover:shadow-[0_16px_32px_-16px_rgba(0,0,0,0.3)] disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-sm"
              >
                <div
                  className="relative h-28 flex items-center justify-center overflow-hidden"
                  style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 62%, black))` }}
                >
                  <span className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full" style={{ background: "rgba(255,255,255,0.14)" }} />
                  <span className="pointer-events-none absolute -left-4 -bottom-10 h-20 w-20 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
                  <span className="relative h-16 w-16 rounded-2xl flex items-center justify-center text-3xl ring-2 ring-white/40 transition-transform group-hover:scale-110" style={{ background: "rgba(255,255,255,0.22)" }}>
                    {SKILL_EMOJI[skill]}
                  </span>
                </div>
                <div className="p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-lg text-ink">{t(`skills.${skill}`)}</span>
                    <span className="font-display font-bold" style={{ color: `color-mix(in srgb, ${color} 80%, black)` }}>
                      {percent}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-rule overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, background: color }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{exhausted ? t("modules.allDone") : t("modules.remainingItems", { count: remaining, total })}</span>
                    {!exhausted && (
                      <span className="flex items-center gap-0.5 font-semibold" style={{ color }}>
                        {tr("Start")}{" "}<ChevronRight size={15} className="transition-transform group-hover:translate-x-1" />
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// One card per question type in the picked skill; navigation layer only, reuses existing content.
// "My path" (the system picks the level and the next set) or "Browse all"
// (pick any type and level); the choice is remembered on this device.
const TAB_KEY = "spica.modulesTab";
function loadTab(): "path" | "browse" {
  try {
    return localStorage.getItem(TAB_KEY) === "browse" ? "browse" : "path";
  } catch {
    return "path";
  }
}

function TypePicker({
  skill,
  starting,
  onBack,
  onSelect,
  onStartSet,
  onOpenUnit,
  onStartCheck,
}: {
  skill: SkillTag;
  starting: boolean;
  onBack: () => void;
  onSelect: (typeId: string) => void;
  onStartCheck: () => void;
  onStartSet: (itemTypeId: string, setId: string) => void;
  onOpenUnit: (itemTypeId: string, unitId: string, unitName: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = SKILL_ICONS[skill];
  const types = SKILL_TYPES[skill];
  const [tab, setTab] = useState(loadTab);
  const pickTab = (next: "path" | "browse") => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Not remembered; the tab still switches.
    }
  };
  // Sets done and started per sub-module, so the learner sees what they've tried.
  const [progress, setProgress] = useState<Record<string, TypeProgress>>({});
  useEffect(() => {
    getTypeProgress(skill)
      .then((r) => setProgress(Object.fromEntries(r.types.map((x) => [x.itemTypeId, x]))))
      .catch(() => {});
  }, [skill]);

  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        onBack={onBack}
        backLabel={t("modules.backToSkills")}
        eyebrow={tr("{{length}} question types", { length: types.length })}
        title={`${t(`skills.${skill}`)} Practice`}
        subtitle={tab === "path" ? tr("Your level and your next set, picked from your results.") : t("modules.pickTypeSubtitle")}
        icon={Icon}
        compact
      />

      <div className="flex gap-2" role="tablist">
        {(
          [
            ["path", tr("My path")],
            ["browse", tr("Browse all")],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => pickTab(k)}
            className={`text-sm px-4 py-1.5 rounded-pill border cursor-pointer ${tab === k ? "bg-navy text-white border-navy" : "border-rule text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "path" ? (
        <MyPath skill={skill} starting={starting} onStartSet={onStartSet} onOpenUnit={onOpenUnit} onStartCheck={onStartCheck} />
      ) : (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {types.map((typeId, i) => {
          const meta = ITEM_TYPE_META[typeId];
          if (!meta) return null;
          const TypeIcon = ITEM_TYPE_ICON[typeId] ?? Icon;
          const tint = CARD_TINT_ROTATION[i % CARD_TINT_ROTATION.length];
          const strip = CARD_STRIP_ROTATION[i % CARD_STRIP_ROTATION.length];
          return (
            <button
              key={typeId}
              onClick={() => onSelect(typeId)}
              disabled={starting}
              className="group relative text-left bg-surface border border-rule rounded-card p-5 transition-all cursor-pointer flex flex-col gap-3 overflow-hidden disabled:opacity-60 disabled:cursor-not-allowed hover:border-rule-strong hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-14px_rgba(0,0,0,0.28)]"
            >
              <span className={`absolute top-0 left-0 right-0 h-1.5 pointer-events-none ${strip}`} />
              <div className="flex items-center justify-between">
                <span className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${tint}`}>
                  <TypeIcon size={22} strokeWidth={2} />
                </span>
                <span className="text-[11px] font-semibold text-muted bg-paper rounded-pill px-2.5 py-1">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-display font-bold text-base text-ink leading-snug">{meta.name}</span>
                <span className="text-xs text-muted leading-relaxed">{t(`modules.typeDesc.${typeId}`)}</span>
              </div>
              {progress[typeId]?.tests.length ? (
                <span className="text-[11px] text-muted">
                  <span className="font-semibold text-ink">{tr("Used in:")}</span> {testsLine(progress[typeId].tests)}
                </span>
              ) : null}
              <TypeProgressLine p={progress[typeId]} />
              <span className="mt-auto flex items-center gap-1 text-xs font-semibold text-navy-deep">
                {(progress[typeId]?.started ?? 0) + (progress[typeId]?.done ?? 0) > 0 ? tr("Continue") : tr("Practise")}{" "}
                <ChevronRight size={14} className="transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}

// Read-then-write questions (Passage Reconstruction): a two-step tracker, a
// clear start card, the paragraph with a shrinking time bar, then the
// writing box with a word count once the paragraph has gone.
function TwoPhaseTask({
  stage,
  readSeconds,
  writeSeconds,
  readLeft,
  passage,
  answerText,
  onAnswerTextChange,
  onStart,
}: {
  stage: "idle" | "reading" | "writing";
  readSeconds: number;
  writeSeconds: number | null;
  readLeft: number | null;
  passage: string;
  answerText: string;
  onAnswerTextChange: (v: string) => void;
  onStart: () => void;
}) {
  const words = answerText.trim() ? answerText.trim().split(/\s+/).length : 0;
  const steps: [string, string, boolean, boolean][] = [
    [tr("Read"), tr("{{n}}s", { n: readSeconds }), stage === "reading", stage === "writing"],
    [tr("Write"), writeSeconds ? tr("{{n}}s", { n: writeSeconds }) : "", stage === "writing", false],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {steps.map(([label, time, active, done], i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <span
              className={`flex items-center gap-2 flex-1 rounded-pill px-3 py-2 text-sm font-semibold border ${
                active ? "bg-navy text-white border-navy" : done ? "bg-success/10 text-success border-success/30" : "bg-paper text-muted border-rule"
              }`}
            >
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs ${active ? "bg-white/20" : done ? "bg-success/15" : "bg-paper-warm"}`}>
                {done ? <CheckCircle2 size={14} /> : i + 1}
              </span>
              {label}
              {time && <span className={`ml-auto text-xs font-mono ${active ? "text-white/80" : "text-muted"}`}>{time}</span>}
            </span>
            {i === 0 && <ChevronRight size={16} className="text-muted shrink-0" />}
          </div>
        ))}
      </div>

      {stage === "idle" && (
        <div className="flex flex-col items-center text-center gap-3 rounded-card border border-dashed border-navy/30 bg-navy/5 px-6 py-8">
          <span className="h-14 w-14 rounded-full bg-navy/15 text-navy-deep flex items-center justify-center">
            <BookOpen size={26} />
          </span>
          <p className="font-display font-bold text-lg text-ink">{tr("Ready? The paragraph shows for {{n}} seconds", { n: readSeconds })}</p>
          <p className="text-sm text-muted max-w-sm">{tr("Read it carefully. When the time is up it disappears, and you write it again in your own words.")}</p>
          <Button onClick={onStart} className="mt-1">
            {tr("Show the paragraph")}
          </Button>
        </div>
      )}

      {stage === "reading" && (
        <div className="flex flex-col gap-2">
          <div className="rounded-card bg-surface border border-rule shadow-sm p-5 text-base leading-relaxed text-ink">{passage}</div>
          <div className="h-1.5 rounded-full bg-rule overflow-hidden">
            <div className="h-full bg-navy transition-all duration-300 ease-linear" style={{ width: `${((readLeft ?? readSeconds) / readSeconds) * 100}%` }} />
          </div>
          <p className="text-xs text-muted text-right">{tr("Disappears in {{n}}s", { n: readLeft ?? readSeconds })}</p>
        </div>
      )}

      {stage === "writing" && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-navy-deep bg-navy/10 rounded-input px-3 py-2">
            <EyeOff size={15} /> {tr("Paragraph hidden: write it again in your own words.")}
          </p>
          <textarea
            value={answerText}
            onChange={(e) => onAnswerTextChange(e.target.value)}
            onPaste={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            placeholder={tr("Start writing here…")}
            autoFocus
            className="w-full rounded-card border border-rule bg-surface px-4 py-3 text-base text-ink shadow-sm focus:border-navy focus:outline-none transition-colors leading-relaxed"
            rows={6}
          />
          <p className="text-xs text-muted text-right">{tr("{{n}} words", { n: words })}</p>
        </div>
      )}
    </div>
  );
}

// A sub-module's progress: all done, some done or started, or not tried yet.
function TypeProgressLine({ p }: { p: TypeProgress | undefined }) {
  if (!p || p.setCount === 0) return null;
  const pct = Math.round((p.done / p.setCount) * 100);
  const all = p.done === p.setCount;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 rounded-full bg-rule overflow-hidden">
        <div className={`h-full rounded-full ${all ? "bg-success" : "bg-navy"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`flex items-center gap-1 text-[11px] font-semibold ${all ? "text-success" : p.done + p.started > 0 ? "text-navy-deep" : "text-muted"}`}>
        {all ? <CheckCircle2 size={12} /> : p.done + p.started > 0 ? <CircleDot size={12} /> : null}
        {all
          ? tr("All {{n}} sets done", { n: p.setCount })
          : p.done + p.started > 0
            ? `${tr("{{done}} of {{n}} sets done", { done: p.done, n: p.setCount })}${p.started ? ` · ${tr("{{n}} in progress", { n: p.started })}` : ""}`
            : tr("Not started · {{n}} sets", { n: p.setCount })}
      </span>
    </div>
  );
}

// Shown only if the picked type has units — types without any skip straight to the old count-based start.
function UnitPicker({
  units,
  pathLevel,
  loading,
  onBack,
  onSelect,
}: {
  units: PracticeUnit[];
  // The learner's "My path" level in this type: marks "You are here".
  pathLevel: string | null;
  loading: boolean;
  onBack: () => void;
  onSelect: (unit: PracticeUnit) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        onBack={onBack}
        backLabel={t("modules.backToTypes")}
        eyebrow={`${units.length} levels`}
        title={t("modules.pickUnitTitle")}
        icon={GraduationCap}
        compact
        stats={
          units.length
            ? [
                { label: tr("Sets completed"), value: units.reduce((n, u) => n + u.completedCount, 0), icon: CheckCircle2 },
                { label: tr("Sets in total"), value: units.reduce((n, u) => n + u.setCount, 0), icon: Layers },
                { label: tr("Levels finished"), value: units.filter((u) => u.setCount > 0 && u.completedCount === u.setCount).length, icon: Trophy },
                { label: tr("Levels to go"), value: units.filter((u) => !(u.setCount > 0 && u.completedCount === u.setCount)).length, icon: Target },
              ]
            : undefined
        }
      />
      {loading ? (
        <p className="text-sm text-muted">{t("modules.loadingAvailability")}</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {units.map((unit) => {
            const percent = unit.setCount > 0 ? Math.round((unit.completedCount / unit.setCount) * 100) : 0;
            const done = unit.setCount > 0 && unit.completedCount === unit.setCount;
            const LV = ["A1", "A2", "B1", "B2", "C1", "C2"];
            const at = LV.indexOf(unit.name.slice(0, 2));
            const here = pathLevel ? LV.indexOf(pathLevel) : -1;
            const mark = here < 0 || at < 0 ? null : at === here ? "here" : at < here ? "review" : "next";
            return (
              <button
                key={unit.id}
                onClick={() => onSelect(unit)}
                className="group text-left flex items-center gap-4 bg-surface border border-rule rounded-card p-6 transition-all cursor-pointer hover:border-rule-strong hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-14px_rgba(0,0,0,0.28)]"
              >
                <ProgressRing percent={percent} size={60} strokeWidth={5} colorClass={done ? "text-success" : "text-navy"}>
                  <span
                    className={`h-10 w-10 rounded-2xl flex items-center justify-center text-xl transition-transform group-hover:scale-110 ${cefrTint(unit.name)}`}
                  >
                    {done ? <CheckCircle2 size={20} /> : cefrEmoji(unit.name)}
                  </span>
                </ProgressRing>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-display font-bold text-base text-ink">{unit.name}</span>
                    {mark === "here" && <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-pill bg-navy text-white">{tr("You are here")}</span>}
                    {mark === "review" && <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-pill bg-success/15 text-success">{tr("Review")}</span>}
                    {mark === "next" && <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-pill bg-rule text-muted">{tr("Next")}</span>}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {done ? t("modules.unitComplete") : t("modules.setsProgress", { done: unit.completedCount, total: unit.setCount })}
                  </div>
                  {mark === "next" && pathLevel && <div className="text-[11px] text-muted mt-0.5">{tr("Recommended after {{level}}", { level: pathLevel })}</div>}
                </div>
                <ChevronRight size={20} className="text-muted shrink-0 transition-transform group-hover:translate-x-1" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// One card per set; selecting one starts the fixed, ordered set instead of an adaptive sample.
function SetPicker({
  unitName,
  sets,
  loading,
  onBack,
  onSelect,
}: {
  unitName: string;
  sets: PracticeSet[];
  loading: boolean;
  onBack: () => void;
  onSelect: (setId: string, started: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        onBack={onBack}
        backLabel={t("modules.backToUnits")}
        eyebrow={tr("{{length}} of {{length2}} sets done", { length: sets.filter((x) => x.completed).length, length2: sets.length })}
        title={unitName}
        icon={ListChecks}
        compact
      />
      {loading ? (
        <p className="text-sm text-muted">{t("modules.loadingAvailability")}</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sets.map((set, i) => (
            <button
              key={set.id}
              onClick={() => onSelect(set.id, set.started)}
              className="group text-left flex items-center gap-4 bg-surface border border-rule rounded-card p-6 transition-all cursor-pointer hover:border-rule-strong hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-14px_rgba(0,0,0,0.28)]"
            >
              <span
                className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 font-display font-bold text-lg transition-transform group-hover:scale-110 ${
                  set.completed ? "bg-success/15 text-success" : set.started ? "bg-navy/15 text-navy-deep" : "bg-accent/15 text-accent"
                }`}
              >
                {set.completed ? <CheckCircle2 size={22} /> : i + 1}
              </span>
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-base font-semibold text-ink">{set.name}</span>
                {set.lastResult && (
                  <span className="text-xs text-muted">
                    {tr("{{right}} of {{total}} right", { right: set.lastResult.right, total: set.lastResult.total })}
                    {set.lastResult.skipped ? ` · ${tr("{{n}} skipped", { n: set.lastResult.skipped })}` : ""}
                  </span>
                )}
              </span>
              {set.started ? (
                <span className="text-xs font-semibold text-navy-deep shrink-0">{tr("In progress")}</span>
              ) : set.completed ? (
                <span className="text-xs font-semibold text-success shrink-0">{tr("Done")}</span>
              ) : (
                <ChevronRight size={20} className="text-muted shrink-0 transition-transform group-hover:translate-x-1" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The organization may have switched Modules off: send learners to Practice Tests.
export function Modules() {
  const modulesOn = useModulesEnabled();
  if (!modulesOn) return <Navigate to={ROUTES.PRACTICE_TESTS} replace />;
  return <ModulesPage />;
}

function ModulesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { recording, start: startRecording, stop: stopRecording } = useVoiceRecorder();

  const [availability, setAvailability] = useState<SkillAvailability[] | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  // A skill picked but no type chosen yet — shows TypePicker instead of
  // starting a session immediately.
  const [pickerSkill, setPickerSkill] = useState<SkillTag | null>(null);
  // A type picked — shows UnitPicker next, unless that type turns out to
  // have no units at all, in which case the fetch effect below skips
  // straight to the old count-based pendingStart automatically.
  const [pickerType, setPickerType] = useState<{ skill: SkillTag; itemTypeId: string } | null>(null);
  const [units, setUnits] = useState<PracticeUnit[]>([]);
  const [pathLevel, setPathLevel] = useState<string | null>(null);
  const [loadingUnits, setLoadingUnits] = useState(false);
  // A unit picked — shows SetPicker next.
  const [pickerUnit, setPickerUnit] = useState<{ skill: SkillTag; itemTypeId: string; unitId: string; unitName: string } | null>(
    null,
  );
  const [sets, setSets] = useState<PracticeSet[]>([]);
  const [loadingSets, setLoadingSets] = useState(false);
  // A start requested (from the auto-start effect, TypePicker's no-units
  // fallback, or SetPicker) but not yet actually begun — the Voice Check
  // gate below renders while this is set, and only calls the real
  // handleStart once it completes.
  // Agreed to the consent screen for the pending start; asked again for every session.
  const [consented, setConsented] = useState(false);
  const [pendingStart, setPendingStart] = useState<{ skill: SkillTag; count?: number; itemTypeId?: string; setId?: string; retry?: boolean; check?: boolean } | null>(
    null,
  );
  // Mirrors pickerSkill/pickerType/pickerUnit into the URL (pSkill/pType/pUnit/pUnitName)
  // so a refresh restores the same browsing screen instead of falling through to
  // the in-progress-session resume check below. null clears all four.
  function updateBrowseParams(next: { pSkill?: string; pType?: string; pUnit?: string; pUnitName?: string } | null) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("pSkill");
        params.delete("pType");
        params.delete("pUnit");
        params.delete("pUnitName");
        if (next) {
          if (next.pSkill) params.set("pSkill", next.pSkill);
          if (next.pType) params.set("pType", next.pType);
          if (next.pUnit) params.set("pUnit", next.pUnit);
          if (next.pUnitName) params.set("pUnitName", next.pUnitName);
        }
        return params;
      },
      { replace: true },
    );
  }

  // Restores pickerSkill/pickerType/pickerUnit from the URL once on mount —
  // runs before the resume-session effect decides whether to honor browsing state.
  const restoredBrowseRef = useRef(false);
  useEffect(() => {
    if (restoredBrowseRef.current) return;
    restoredBrowseRef.current = true;
    const pSkill = searchParams.get("pSkill");
    const pType = searchParams.get("pType");
    const pUnit = searchParams.get("pUnit");
    const pUnitName = searchParams.get("pUnitName");
    if (pSkill === "listening" || pSkill === "speaking" || pSkill === "reading" || pSkill === "writing") {
      setPickerSkill(pSkill);
      if (pType) {
        setPickerType({ skill: pSkill, itemTypeId: pType });
        if (pUnit && pUnitName) {
          setPickerUnit({ skill: pSkill, itemTypeId: pType, unitId: pUnit, unitName: pUnitName });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [faceEnrolled, setFaceEnrolled] = useState<boolean | null>(null);
  useEffect(() => {
    getFaceEnrollmentStatus()
      .then((res) => setFaceEnrolled(res.enrolled))
      .catch(() => setFaceEnrolled(true));
  }, []);

  useEffect(() => {
    if (!pickerType) return;
    let cancelled = false;
    setLoadingUnits(true);
    getUnits(pickerType.itemTypeId, pickerType.skill)
      .then((res) => {
        if (cancelled) return;
        if (res.units.length === 0) {
          // No units authored for this type yet — fall straight back to the
          // old count-based session start, same as before this feature.
          setPendingStart({ skill: pickerType.skill, itemTypeId: pickerType.itemTypeId });
          setPickerType(null);
          updateBrowseParams(null);
        } else {
          setUnits(res.units);
          setPathLevel(res.pathLevel ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPendingStart({ skill: pickerType.skill, itemTypeId: pickerType.itemTypeId });
          setPickerType(null);
          updateBrowseParams(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingUnits(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerType]);

  useEffect(() => {
    if (!pickerUnit) return;
    let cancelled = false;
    setLoadingSets(true);
    getSets(pickerUnit.unitId, pickerUnit.skill)
      .then((res) => {
        if (!cancelled) setSets(res.sets);
      })
      .catch(() => {
        if (!cancelled) setSets([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerUnit]);
  // No enrollment yet when a start is requested — redirect to enroll
  // first, since this page has no upstream Placement.tsx-style gate.
  useEffect(() => {
    if (pendingStart && faceEnrolled === false) {
      navigate(ROUTES.FACE_ENROLLMENT, { state: { next: `${location.pathname}${location.search}` } });
    }
  }, [pendingStart, faceEnrolled, navigate, location.pathname, location.search]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  // Set by a mid-session spoof detection — re-shows the gate, session stays intact.
  const [requireReverify, setRequireReverify] = useState(false);
  const [items, setItems] = useState<TestItem[]>([]);
  const [index, setIndex] = useState(0);
  // Leaving the page stops any recording still playing.
  useEffect(() => () => stopSpokenAudio(), []);
  const [answers, setAnswers] = useState<Record<number, CachedAnswer>>({});
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  // Real time spent on the current question — reset whenever a new question
  // is shown (the [index] effect below), read at submit/skip time. Counts
  // only while actually on a question, never idle time elsewhere in the app.
  const questionShownAtRef = useRef(Date.now());

  // Gates the whole render until this resolves, so a refresh mid-session
  // lands back in that same session instead of flashing the picker screens
  // first — Placement already had this via getCurrentSession, practice didn't.
  const [resumeChecked, setResumeChecked] = useState(false);
  useEffect(() => {
    function applyResumedSession(res: { sessionId: string; items: TestItem[]; context?: PracticeContext }) {
      setSessionId(res.sessionId);
      setItems(res.items);
      setContext(res.context ?? null);
      const firstUnattempted = res.items.findIndex((item) => !item.attempted);
      setIndex(firstUnattempted === -1 ? 0 : firstUnattempted);
      setAnswers(
        Object.fromEntries(
          res.items.flatMap((item, i) => (item.attempted ? [[i, { responseText: item.responseText ?? "" }]] : [])),
        ),
      );
      // A resumed set (page reload): smart resume, see introFor.
      void introFor(res.sessionId, res.items);
    }

    const sessionIdParam = searchParams.get("session");
    if (sessionIdParam) {
      // The exact session the learner was in — resume it by id, not by
      // guessing from skill/type (which can't tell two in-progress sessions
      // of the same skill apart, e.g. an old abandoned one vs. this one).
      getPracticeSession(sessionIdParam)
        .then((res) => {
          if (!res.completed) applyResumedSession(res);
        })
        .catch(() => {})
        .finally(() => setResumeChecked(true));
      return;
    }

    // No session= in the URL — only a bare /modules visit (no skill/type
    // picked, no browse state restored) auto-resumes whatever's in progress,
    // as a "continue where you left off" shortcut. Any explicit navigation
    // (a skill picked, or deeper into type/unit) shows that screen instead —
    // picking a type/set there will naturally resume its own match via
    // POST /session, without this blind global check interfering.
    const explicitNavigation = searchParams.has("pSkill") || searchParams.has("skill") || searchParams.has("pType") || searchParams.has("pUnit");
    if (explicitNavigation) {
      setResumeChecked(true);
      return;
    }
    getCurrentPracticeSession()
      .then((res) => {
        if (!res.inProgress) return;
        applyResumedSession(res);
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            params.set("session", res.sessionId);
            return params;
          },
          { replace: true },
        );
      })
      .catch(() => {})
      .finally(() => setResumeChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [hasPlayed, setHasPlayed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<{ base64: string; mimeType: string } | null>(null);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [recordingDurationMs, setRecordingDurationMs] = useState<number | null>(null);
  const [summary, setSummary] = useState<PracticeSummary | null>(null);
  // Feedback on the answer just given: right or wrong and the right answer.
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  // The set being taken: skill, sub-module, level and set name.
  const [context, setContext] = useState<PracticeContext | null>(null);
  // Countdown beeps off for every question (remembered).
  const [muted, setMuted] = useState(loadMuted);
  // Phone layout for the question card: the page scrolls (no inner scroll),
  // the buttons stay at the bottom, and the header is shorter.
  const small = useSmallScreen();
  // Stops once the score report shows — nothing left to verify identity
  // against after the test is already complete.
  usePeriodicFaceCheck(Boolean(sessionId) && !summary && !requireReverify, "practice", sessionId, () => setRequireReverify(true));
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // Gates the first question behind the type's real instruction_text (how
  // this task works) on a genuinely fresh start — not shown again when
  // resuming a session already partway through, since that'd already been seen.
  const [showTypeIntro, setShowTypeIntro] = useState(false);
  // Smart resume: checking quietly, the problem a quick check found (then the
  // full check shows), or a "welcome back" line on the question screen.
  const [checkingResume, setCheckingResume] = useState(false);
  const [resumeProblem, setResumeProblem] = useState<QuickCheckProblem | null>(null);
  const [welcomeBack, setWelcomeBack] = useState(false);
  // "two-phase" items (Passage Reconstruction): show the passage, then hide
  // it and switch to a blank textarea — testing recall, not copying.
  const [twoPhaseStage, setTwoPhaseStage] = useState<"idle" | "reading" | "writing">("idle");
  const twoPhaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Seconds left to read before the paragraph disappears.
  const [readLeft, setReadLeft] = useState<number | null>(null);
  useEffect(() => {
    if (twoPhaseStage !== "reading") {
      setReadLeft(null);
      return;
    }
    const t0 = Date.now();
    const total = current?.twoPhaseReadSeconds ?? DEFAULT_TWO_PHASE_READ_SECONDS;
    setReadLeft(total);
    const iv = setInterval(() => setReadLeft(Math.max(0, total - Math.floor((Date.now() - t0) / 1000))), 250);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twoPhaseStage]);

  useEffect(() => {
    getAvailability()
      .then((res) => setAvailability(res.availability))
      .catch(() => setAvailability(null))
      .finally(() => setLoadingAvailability(false));
  }, []);

  // A fresh start shows the device check and guide. Coming back to a set
  // already answered in skips them when it was in use here in the last 30
  // minutes, else runs a quick check on its own and shows the full check
  // only if that finds a problem.
  async function introFor(id: string, list: TestItem[]) {
    setResumeProblem(null);
    if (!list.some((i) => i.attempted)) {
      setWelcomeBack(false);
      setShowTypeIntro(true);
      return;
    }
    setCheckingResume(true);
    const problem = await resumeNeedsFullCheck(id, list.some((i) => i.inputMethod === "mic")).catch(() => "internet" as const);
    setCheckingResume(false);
    if (problem) {
      setResumeProblem(problem);
      setShowTypeIntro(true);
    } else {
      setWelcomeBack(true);
    }
  }

  async function handleStart(skill: SkillTag, count?: number, itemTypeId?: string, setId?: string, retry?: boolean, check?: boolean) {
    setStarting(true);
    setError(null);
    try {
      const res = await startPracticeSession(skill, count, itemTypeId, setId, retry, check);
      setSessionId(res.sessionId);
      setItems(res.items);
      setContext(res.context ?? null);
      // Tags the URL with this exact session so a refresh resumes it by id
      // instead of falling back to skill/type guesswork — clearing the
      // browse-picker params at the same time, since we're done browsing.
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.delete("pSkill");
          params.delete("pType");
          params.delete("pUnit");
          params.delete("pUnitName");
          params.set("session", res.sessionId);
          return params;
        },
        { replace: true },
      );
      // Resuming an in-progress session returns every item with its own
      // `attempted` flag — land on the first one that isn't, instead of
      // always rewinding to index 0 (that used to make "Continue where you
      // left off" on Overview show already-answered question 1 again).
      const firstUnattempted = res.items.findIndex((item) => !item.attempted);
      setIndex(firstUnattempted === -1 ? 0 : firstUnattempted);
      setAnswers(
        Object.fromEntries(
          res.items.flatMap((item, i) => (item.attempted ? [[i, { responseText: item.responseText ?? "" }]] : [])),
        ),
      );
      setSummary(null);
      setFeedback(null);
      // The device check and guide on a fresh start; smart resume otherwise.
      void introFor(res.sessionId, res.items);
    } catch (err) {
      // Not in the learner's plan: the page shows the standard locked card instead.
      if (lockedByServer(err)) return;
      setError(t("modules.startError"));
    } finally {
      setStarting(false);
    }
  }

  // ?skill= alone shows the type picker; ?skill=+?type= (from Today's Tasks)
  // skips straight to that type. Re-runs on any URL change, not just mount —
  // guarded by the last-processed query string so StrictMode's double-invoke
  // only acts once, but a genuine navigation (e.g. a Sidebar skill link)
  // still goes through, fixing a bug where it got stuck on the first skill.
  const lastAutoStart = useRef<string | null>(null);
  const autoStartMounted = useRef(false);
  useEffect(() => {
    // Keyed only on skill/type/count — not the full query string — so that
    // updateBrowseParams setting pSkill/pType/pUnit (as the learner clicks
    // into Type/Unit/Set) doesn't look like a fresh deep-link and wipe them
    // straight back out.
    const raw = `${searchParams.get("skill")}|${searchParams.get("type")}|${searchParams.get("count")}|${searchParams.get("set")}|${searchParams.get("retry")}|${searchParams.get("check")}`;
    const firstRun = !autoStartMounted.current;
    autoStartMounted.current = true;
    if (lastAutoStart.current === raw) return;
    lastAutoStart.current = raw;
    // On the very first render (e.g. a refresh), a deeper browse state
    // (pType/pUnit, restored by the effect above from the URL) wins over
    // this effect's own reset-to-TypePicker behavior — only a genuine new
    // ?skill= click while the app is already running should reset it.
    if (firstRun && (searchParams.has("pType") || searchParams.has("pUnit"))) return;
    const skill = searchParams.get("skill");
    const count = searchParams.get("count");
    const itemTypeId = searchParams.get("type");
    // From Overview's "next step": one exact set, or a review of past mistakes.
    const setId = searchParams.get("set");
    const retry = searchParams.get("retry") === "1";
    const check = searchParams.get("check") === "1";
    if (skill === "listening" || skill === "speaking" || skill === "reading" || skill === "writing") {
      // A skill link always wins over what's showing, even mid-session — attempts save per item, so nothing's lost.
      setSessionId(null);
      setItems([]);
      setSummary(null);
      setPickerType(null);
      setPickerUnit(null);
      // Drop the old session= so a later refresh can't resume a session for
      // the skill just navigated away from.
      if (!firstRun) {
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            params.delete("session");
            return params;
          },
          { replace: true },
        );
      }
      if (setId || retry || check) {
        setPendingStart({ skill, setId: setId ?? undefined, retry: retry || undefined, check: check || undefined });
      } else if (itemTypeId) {
        setPendingStart({ skill, count: count ? Number(count) : undefined, itemTypeId });
      } else {
        setPendingStart(null);
        setPickerSkill(skill);
      }
    }
  }, [searchParams]);

  const current = items[index];

  // A spoken answer is scored in the background: check back for its feedback.
  useEffect(() => {
    if (feedback?.status !== "pending" || !sessionId || !current) return;
    const itemId = current.id;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      getModuleFeedback(sessionId, itemId)
        .then((r) => {
          if (r.feedback.status !== "pending") {
            setFeedback(r.feedback);
            clearInterval(timer);
          }
        })
        .catch(() => {});
      if (tries >= 15) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback?.status, sessionId, current?.id]);

  const needsAudioFirst = current ? AUDIO_FIRST_TYPES.has(current.itemTypeId) : false;
  const visibleText = current && !needsAudioFirst ? getVisibleText(current) : "";
  const meta = current ? ITEM_TYPE_META[current.itemTypeId] : undefined;

  useEffect(() => {
    // A pending two-phase read timer belongs to the question it was started
    // on — moving away (Skip/Back) before it fires must not let it force a
    // *different*, still-idle two-phase question straight to writing later.
    if (twoPhaseTimeoutRef.current !== null) {
      clearTimeout(twoPhaseTimeoutRef.current);
      twoPhaseTimeoutRef.current = null;
    }
    // A recording still playing from the last question stops (Skip, Back, Next).
    stopSpokenAudio();
    setPlaying(false);
    questionShownAtRef.current = Date.now();
    const cached = answersRef.current[index];
    setAnswerText(cached?.responseText ?? "");
    setPendingAudio(cached?.audioBase64 ? { base64: cached.audioBase64, mimeType: cached.audioMimeType ?? "" } : null);
    setAudioBlobUrl(cached?.audioBlobUrl ?? null);
    setRecordingDurationMs(cached?.durationMs ?? null);
    setHasPlayed(!!cached);
    setTwoPhaseStage(cached ? "writing" : "idle");
    setError(null);
  }, [index]);

  // Each question's countdown: its whole time (listening, reading, answering).
  // At zero a recording in progress is stopped and kept, and the learner
  // submits or moves on.
  const questionSeconds = current?.questionSeconds ?? current?.timerSeconds ?? null;
  // Only while a question is being answered: it stops the moment Skip or Next
  // is pressed (saving and checking a spoken answer takes a few seconds), and
  // never runs behind the guide, the results or the pickers. The next question
  // starts its own full countdown.
  const questionOnScreen = !!sessionId && !summary && !showTypeIntro && !submitting && !feedback;
  useEffect(() => {
    if (!questionSeconds || !questionOnScreen) {
      if (!questionSeconds || summary || !sessionId) setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds((prev) => prev ?? questionSeconds);
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, questionSeconds, questionOnScreen]);
  // A new question starts its own full countdown.
  useEffect(() => {
    setRemainingSeconds(questionSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  // Beeps in the last 5 seconds (unless muted); time up stops a recording.
  useEffect(() => {
    if (remainingSeconds === null || !questionOnScreen) return;
    if (remainingSeconds > 0 && remainingSeconds <= 5 && !muted) beep();
    if (remainingSeconds === 0) {
      if (!muted) beep(440, 400);
      if (recording) void handleToggleRecord();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSeconds]);

  function handleStartReading() {
    if (!current) return;
    setTwoPhaseStage("reading");
    const readSeconds = current.twoPhaseReadSeconds ?? DEFAULT_TWO_PHASE_READ_SECONDS;
    twoPhaseTimeoutRef.current = setTimeout(() => {
      twoPhaseTimeoutRef.current = null;
      setTwoPhaseStage("writing");
    }, readSeconds * 1000);
  }

  async function handlePlay() {
    if (!current) return;
    setPlaying(true);
    const result = await playSpokenAudio(current, getSpokenSegments(current));
    // Stopped by Skip or Back: the new question's state is already set.
    if (result === "stopped") return;
    setPlaying(false);
    setHasPlayed(true);
    if (result === "missing") setError(NO_RECORDING_TEXT());
  }

  async function handleToggleRecord() {
    setError(null);
    if (!recording) {
      try {
        await startRecording();
      } catch {
        setError(t("placementTest.micError"));
      }
      return;
    }
    const { blob, mimeType, transcript, durationMs } = await stopRecording();
    if (transcript) setAnswerText(transcript);
    if (blob) {
      const base64 = await blobToBase64(blob);
      setPendingAudio({ base64, mimeType });
      setAudioBlobUrl(URL.createObjectURL(blob));
      setRecordingDurationMs(durationMs);
    }
  }

  function cacheCurrentAnswer() {
    setAnswers((prev) => ({
      ...prev,
      [index]: {
        responseText: answerText,
        audioBase64: pendingAudio?.base64,
        audioMimeType: pendingAudio?.mimeType,
        audioBlobUrl: audioBlobUrl ?? undefined,
        durationMs: recordingDurationMs ?? undefined,
      },
    }));
  }

  async function finishOrAdvance() {
    setFeedback(null);
    // A Level check picks each next question from the answers so far.
    if (context?.check && sessionId && index + 1 >= items.length) {
      const step = await nextCheckQuestion(sessionId);
      if (!step.done) {
        setItems((prev) => [...prev, step.item]);
        setIndex(index + 1);
        return;
      }
    }
    if (index + 1 < items.length) {
      setIndex(index + 1);
    } else if (sessionId) {
      const result = await completePracticeSession(sessionId);
      setSummary(result);
      getAvailability()
        .then((res) => setAvailability(res.availability))
        .catch(() => {});
    }
  }

  async function handleSubmit() {
    if (!current || !sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitPracticeAttempt(sessionId, {
        itemId: current.id,
        responseText: answerText.trim() || undefined,
        audioBase64: pendingAudio?.base64,
        audioMimeType: pendingAudio?.mimeType,
        durationMs: recordingDurationMs ?? undefined,
        activeMs: Date.now() - questionShownAtRef.current,
      });
      cacheCurrentAnswer();
      markChecked(sessionId);
      setWelcomeBack(false);
      // How the answer did, before moving on (a spoken answer may still be
      // being scored: the learner can go on meanwhile).
      if (res.feedback) {
        setFeedback(res.feedback);
        return;
      }
      await finishOrAdvance();
    } catch {
      setError(t("placementTest.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    stopSpokenAudio();
    setPlaying(false);
    if (!current || !sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPracticeAttempt(sessionId, { itemId: current.id, activeMs: Date.now() - questionShownAtRef.current });
      markChecked(sessionId);
      setWelcomeBack(false);
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      await finishOrAdvance();
    } catch {
      setError(t("placementTest.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleBack() {
    stopSpokenAudio();
    setPlaying(false);
    if (index === 0) return;
    setFeedback(null);
    cacheCurrentAnswer();
    setIndex(index - 1);
  }

  function resetToPicker() {
    setFeedback(null);
    setSessionId(null);
    setItems([]);
    setSummary(null);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("session");
        return params;
      },
      { replace: true },
    );
  }

  if (!resumeChecked) return null;

  if (requireReverify) {
    return <FaceCheck mode="verify" purpose="practice" onComplete={() => setRequireReverify(false)} />;
  }

  // No active or just-finished session — show the skill picker, or the
  // type picker if a skill's already been chosen but no specific type yet.
  if (!sessionId && !starting) {
    // A start was requested but we don't know enrollment status yet, or
    // we're about to redirect to enroll (per the effect above) — show
    // nothing rather than flash the picker screens behind it.
    if (pendingStart && faceEnrolled === null) return null;
    if (pendingStart && faceEnrolled === false) return null;
    if (pendingStart && faceEnrolled) {
      const { skill, count, itemTypeId, setId, retry, check } = pendingStart;
      // What the session collects comes first, then the face check.
      if (!consented) {
        return <TestConsent kind="module" onBack={() => setPendingStart(null)} onAgreed={() => setConsented(true)} />;
      }
      return (
        <FaceCheck
          mode="verify"
          purpose="practice"
          onBack={() => {
            setConsented(false);
            setPendingStart(null);
          }}
          onComplete={() => {
            setConsented(false);
            setPendingStart(null);
            handleStart(skill, count, itemTypeId, setId, retry, check);
          }}
        />
      );
    }
    if (pickerUnit) {
      return (
        <SetPicker
          unitName={pickerUnit.unitName}
          sets={sets}
          loading={loadingSets}
          onBack={() => {
            setPickerUnit(null);
            updateBrowseParams({ pSkill: pickerUnit.skill, pType: pickerUnit.itemTypeId });
          }}
          onSelect={(setId, started) => {
            // Coming back to a set in progress skips the consent and face check.
            if (started) {
              updateBrowseParams(null);
              void handleStart(pickerUnit.skill, undefined, pickerUnit.itemTypeId, setId);
              return;
            }
            setPendingStart({ skill: pickerUnit.skill, itemTypeId: pickerUnit.itemTypeId, setId });
            updateBrowseParams(null);
          }}
        />
      );
    }
    if (pickerType) {
      return (
        <UnitPicker
          units={units}
          pathLevel={pathLevel}
          loading={loadingUnits}
          onBack={() => {
            setPickerType(null);
            updateBrowseParams({ pSkill: pickerType.skill });
          }}
          onSelect={(unit) => {
            setPickerUnit({ ...pickerType, unitId: unit.id, unitName: unit.name });
            updateBrowseParams({ pSkill: pickerType.skill, pType: pickerType.itemTypeId, pUnit: unit.id, pUnitName: unit.name });
          }}
        />
      );
    }
    if (pickerSkill) {
      return (
        <TypePicker
          skill={pickerSkill}
          starting={starting}
          onBack={() => {
            setPickerSkill(null);
            updateBrowseParams(null);
          }}
          onSelect={(typeId) => {
            setPickerType({ skill: pickerSkill, itemTypeId: typeId });
            updateBrowseParams({ pSkill: pickerSkill, pType: typeId });
          }}
          onStartSet={(itemTypeId, setId) => {
            setPendingStart({ skill: pickerSkill, itemTypeId, setId });
            updateBrowseParams(null);
          }}
          onStartCheck={() => {
            setPendingStart({ skill: pickerSkill, check: true });
            updateBrowseParams(null);
          }}
          onOpenUnit={(itemTypeId, unitId, unitName) => {
            setPickerType({ skill: pickerSkill, itemTypeId });
            setPickerUnit({ skill: pickerSkill, itemTypeId, unitId, unitName });
            updateBrowseParams({ pSkill: pickerSkill, pType: itemTypeId, pUnit: unitId, pUnitName: unitName });
          }}
        />
      );
    }
    return (
      <SkillPicker
        availability={availability}
        loading={loadingAvailability}
        starting={starting}
        onStart={(skill) => {
          setPickerSkill(skill);
          updateBrowseParams({ pSkill: skill });
        }}
      />
    );
  }

  if (starting && !sessionId) {
    return <p className="text-sm text-muted">{t("modules.starting")}</p>;
  }

  if (summary) {
    const qs = summary.questions ?? [];
    const right = qs.filter((q) => q.outcome === "right").length;
    const wrong = qs.filter((q) => q.outcome === "wrong").length;
    const skipped = qs.filter((q) => q.outcome === "skipped").length;
    const pending = qs.filter((q) => q.outcome === "pending").length;
    const total = qs.length || summary.gradedCount + summary.pendingCount;
    const pct = total ? Math.round((right / total) * 100) : 0;
    // The message follows the score: no "Nice work" for 2 of 5.
    const headline =
      total === 0 || pending === total
        ? tr("Set finished")
        : pct >= 80
          ? tr("Great work")
          : pct >= 50
            ? tr("Good effort")
            : tr("Keep practising");
    const advice =
      pending > 0
        ? tr("{{n}} answers are still being scored; they'll show here when you open this set again.", { n: pending })
        : pct >= 80
          ? tr("You're ready for the next set.")
          : pct >= 50
            ? tr("Look at the ones you missed below, then try the next set.")
            : tr("Go through the right answers below. Try this set again or move to the next one.");
    const c = summary.context ?? context;
    const backToSets = () => {
      resetToPicker();
      if (c?.skill && c.itemTypeId) {
        setPickerSkill(c.skill);
        setPickerType({ skill: c.skill, itemTypeId: c.itemTypeId });
        updateBrowseParams({ pSkill: c.skill, pType: c.itemTypeId });
      }
    };
    const progress = summary.unitProgress;
    const levelDone = !!progress?.levelComplete;
    // Celebrate a decent set (and every finished level); a weak one gets encouragement instead.
    const celebrate = pending < total && (pct >= 50 || levelDone);
    const change = summary.pathChange;
    return (
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-5">
        {(celebrate || change?.direction === "up" || (summary.checkResult && summary.checkResult.level > summary.checkResult.from)) && <Confetti key={sessionId ?? "done"} pieces={levelDone || change?.direction === "up" ? 160 : 90} />}
        <div className="bg-surface border border-rule rounded-card shadow-sm p-6 sm:p-8 flex flex-col gap-4">
          <p className="text-xs uppercase tracking-wide text-muted">
            {[c?.skill ? t(`skills.${c.skill}`) : null, c?.check ? tr("Level check") : c?.retry ? tr("Mistakes to retry") : c?.typeName, c?.unitName, c?.setName].filter(Boolean).join(" · ")}
          </p>
          {c?.tests?.length ? <p className="text-xs text-muted -mt-2">{tr("Used in these tests: {{tests}}", { tests: testsLine(c.tests) })}</p> : null}
          <div className="flex items-center gap-4">
            <ProgressRing percent={pct} size={72} strokeWidth={6} colorClass={pct >= 80 ? "text-success" : pct >= 50 ? "text-navy" : "text-warning"}>
              <span className="font-display font-bold text-lg text-ink">{pct}%</span>
            </ProgressRing>
            <div>
              <h1 className="font-display font-bold text-2xl text-ink">{headline}</h1>
              <p className="text-sm text-ink">{tr("{{right}} of {{total}} right.", { right, total })}</p>
              <p className="text-sm text-muted">{advice}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-success/10 rounded-card py-2">
              <div className="font-display font-bold text-xl text-success">{right}</div>
              <div className="text-xs text-muted">{tr("Right")}</div>
            </div>
            <div className="bg-error/10 rounded-card py-2">
              <div className="font-display font-bold text-xl text-error">{wrong}</div>
              <div className="text-xs text-muted">{tr("Wrong")}</div>
            </div>
            <div className="bg-warning/10 rounded-card py-2">
              <div className="font-display font-bold text-xl text-warning">{skipped}</div>
              <div className="text-xs text-muted">{tr("Skipped")}</div>
            </div>
          </div>
          {summary.checkResult && c?.skill && (
            <div className="rounded-card bg-navy/5 border border-navy/20 px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-navy text-white flex flex-col items-center justify-center shrink-0">
                <span className="font-display font-bold text-2xl leading-none">{summary.checkResult.level}</span>
              </div>
              <p className="text-sm text-ink flex-1">
                <span className="font-semibold block text-base">{tr("Your {{skill}} level: {{level}}", { skill: t(`skills.${c.skill}`).toLowerCase(), level: summary.checkResult.level })}</span>
                {summary.checkResult.level === summary.checkResult.from
                  ? tr("Same as before. Your path stays at {{level}}.", { level: summary.checkResult.level })
                  : tr("Your path moves from {{from}} to {{to}} for every {{skill}} question type.", { from: summary.checkResult.from, to: summary.checkResult.level, skill: t(`skills.${c.skill}`).toLowerCase() })}
              </p>
              <Button
                onClick={() => {
                  resetToPicker();
                  setPickerSkill(c.skill!);
                  updateBrowseParams({ pSkill: c.skill! });
                }}
                className="shrink-0"
              >
                {tr("Continue my path")}
              </Button>
            </div>
          )}
          <SetDoneStrip summary={summary} />
          {levelDone && progress && (
            <div className="rounded-card bg-success/10 border border-success/30 px-4 py-3 flex items-center gap-3">
              <Trophy size={22} className="text-success shrink-0" />
              <p className="text-sm text-ink">
                <span className="font-semibold">{tr("Level complete!")}</span> {tr("You finished all {{n}} sets in {{level}}.", { n: progress.total, level: progress.unitName })}
              </p>
            </div>
          )}
          {change && (
            <div
              className={`rounded-card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${change.direction === "up" ? "bg-success/10 border border-success/30" : "bg-navy/5 border border-navy/20"}`}
            >
              <p className="text-sm text-ink flex-1">
                {change.direction === "up" ? (
                  <>
                    <span className="font-semibold">{tr("Level up: {{from}} → {{to}}", { from: change.from, to: change.to })}</span>{" "}
                    {tr("You passed {{from}} in {{type}}. Your path now continues at {{to}}.", { from: change.from, type: change.typeName, to: change.to })}
                  </>
                ) : (
                  tr("Two hard sets in a row. Your {{type}} path moves to {{to}} to build up, then back to {{from}}.", { type: change.typeName, to: change.to, from: change.from })
                )}
              </p>
              {c?.skill && (
                <Button
                  variant={change.direction === "up" ? "primary" : "secondary"}
                  onClick={() => {
                    resetToPicker();
                    setPickerSkill(c.skill!);
                    updateBrowseParams({ pSkill: c.skill! });
                  }}
                  className="shrink-0"
                >
                  {tr("Continue my path")}
                </Button>
              )}
            </div>
          )}
          {summary.failedCount > 0 && <p className="text-sm text-error">{t("placementTest.failedNote", { failed: summary.failedCount })}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {summary.next && c?.skill && (
              <Button
                onClick={() => {
                  const next = summary.next!;
                  resetToPicker();
                  setPendingStart({ skill: c.skill!, itemTypeId: c.itemTypeId ?? undefined, setId: next.setId });
                }}
                className="flex-1 min-w-48"
              >
                {tr("Next set: {{name}}", { name: summary.next.unitName === c.unitName ? summary.next.setName : `${summary.next.unitName} · ${summary.next.setName}` })}
              </Button>
            )}
            <Button variant="secondary" onClick={backToSets} className="flex-1 min-w-40">
              {tr("Back to sets")}
            </Button>
          </div>
        </div>
        {summary.detail?.speaking && <SpeakingDetail s={summary.detail.speaking} />}
        {summary.detail?.writing && <WritingDetail w={summary.detail.writing} />}
        {qs.length > 0 && <QuestionReview questions={qs} initialFilter="all" />}
      </div>
    );
  }

  if (!current) return null;

  if (checkingResume) return <p className="text-sm text-muted text-center mt-10">{tr("Getting back to your set…")}</p>;

  if (showTypeIntro) {
    return (
      <ModuleGuide
        items={items}
        context={context}
        typeName={ITEM_TYPE_META[current.itemTypeId]?.name ?? context?.typeName ?? ""}
        instruction={current.instructionText}
        onStart={() => {
          markChecked(sessionId);
          setResumeProblem(null);
          setShowTypeIntro(false);
        }}
        problem={resumeProblem}
        onBack={resetToPicker}
        resumeAt={items.some((i) => i.attempted) ? index + 1 : undefined}
      />
    );
  }

  // A mic answer is submittable once there's a saved recording, whether or
  // not live transcription produced any text — an empty transcript falls
  // through to pending/manual review server-side, rather than blocking
  // submission entirely.
  const canSubmit = current.inputMethod === "mic" ? !recording && !!audioBlobUrl : answerText.trim() !== "";
  // A Level check doesn't know its length in advance: count up to its most questions.
  const shownTotal = context?.check ? Math.max(items.length, context.checkMax ?? items.length) : items.length;
  const progressPct = Math.round((index / shownTotal) * 100);
  const primarySkill = (meta?.skills ?? current.skills)[0];
  const TypeIcon = ITEM_TYPE_ICON[current.itemTypeId] ?? Headphones;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3">
      {/* Height follows the actual content, between a floor (so a one-line
          item doesn't look like a tiny stub) and a ceiling (so the card
          never forces the footer off-screen) — a single fixed number can't
          fit both a Play-button-only item and a long passage+essay item
          without either a dead gap or clipped content. Only content past
          the ceiling scrolls internally. */}
      <div
        className={`relative w-full bg-surface border border-rule rounded-card shadow-sm flex flex-col ${small ? "" : "overflow-hidden"}`}
        style={small ? undefined : { minHeight: "420px", maxHeight: "min(780px, calc(100vh - 180px))" }}
        // On a phone the keyboard covers the lower half: keep the answer box in view.
        onFocusCapture={(e) => {
          const el = e.target;
          if (small && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
        }}
      >
        {/* A light skill-tinted wash across the whole card (not just an
            icon badge) — distinct from Practice Tests' navy/cream
            "You hear / You say" panels, giving Modules its own, friendlier
            identity instead of reusing the same visual language. */}
        <span className={`absolute inset-0 rounded-card pointer-events-none ${SKILL_WASH_CLASSES[primarySkill]}`} />
        <div className={`relative flex-1 flex flex-col justify-start ${small ? "p-4 gap-4" : "p-8 pt-6 gap-5 overflow-y-auto"}`}>
          {/* While feedback shows, the question stays visible and its answer locked. */}
          <div className={feedback ? "pointer-events-none flex flex-col gap-5" : "contents"} aria-disabled={!!feedback}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ProgressRing percent={progressPct} size={48} strokeWidth={4} colorClass={SKILL_RING_COLOR[primarySkill]}>
                  <span className={`h-8 w-8 rounded-xl flex items-center justify-center ${SKILL_TINT_CLASSES[primarySkill]}`}>
                    <TypeIcon size={16} strokeWidth={2} />
                  </span>
                </ProgressRing>
                <div className="flex flex-col">
                  <span className="font-display font-bold text-sm text-ink leading-tight">{meta?.name}</span>
                  <span className="text-[11px] text-muted">
                    {[context?.unitName, context?.setName].filter(Boolean).join(" · ")}
                    {context?.unitName || context?.setName ? " · " : ""}
                    <span className="font-mono">
                      {context?.check ? tr("Question {{n}} · up to {{max}}", { n: index + 1, max: shownTotal }) : t("placementTest.progress", { current: index + 1, total: items.length })}
                    </span>
                  </span>
                  {context?.tests?.length && !small ? <span className="text-[11px] text-muted">{tr("Tests: {{tests}}", { tests: testsLine(context.tests) })}</span> : null}
                </div>
              </div>
              {remainingSeconds !== null ? (
                <span className="flex items-center gap-1.5">
                  <span
                    className={`flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1 rounded-pill border transition-colors ${
                      remainingSeconds <= 5 ? "text-error border-error/30 bg-error/10" : "text-navy-deep border-navy/20 bg-navy/10"
                    }`}
                  >
                    <Clock size={16} />
                    {String(Math.floor(remainingSeconds / 60)).padStart(1, "0")}:{String(remainingSeconds % 60).padStart(2, "0")}
                  </span>
                  <button
                    onClick={() => {
                      setMuted((m) => {
                        saveMuted(!m);
                        return !m;
                      });
                    }}
                    className="h-7 w-7 rounded-full border border-rule flex items-center justify-center text-muted hover:text-ink cursor-pointer"
                    aria-label={muted ? tr("Turn the countdown beeps on") : tr("Mute the countdown beeps")}
                    title={muted ? tr("Turn the countdown beeps on") : tr("Mute the countdown beeps")}
                  >
                    {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                </span>
              ) : null}
            </div>
            <div className={small ? "hidden" : "flex items-center gap-1.5"}>
              {(meta?.skills ?? current.skills).map((skill) => (
                <span
                  key={skill}
                  className={`text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill border ${SKILL_BADGE_CLASS[skill]}`}
                >
                  {t(`skills.${skill}`)}
                </span>
              ))}
            </div>
          </div>

          {welcomeBack && (
            <p className="text-sm text-navy-deep bg-navy/5 border border-navy/15 rounded-input px-3 py-2 text-center">
              {tr("Welcome back. You're on question {{n}} of {{total}}.", { n: index + 1, total: items.length })}
            </p>
          )}

          {/* The real task explanation ("Listen to the conversation and
              answer the question."), not the short per-item prompt — shown
              as a proper heading every time, not just once in the one-time
              type intro, so it's never just the vague "Answer the
              question." with no context. */}
          {small && index > 0 ? (
            // On a phone, after the first question: one tap to see it again.
            <details className="bg-paper-warm/70 border border-rule rounded-card px-3 py-2">
              <summary className="text-xs font-semibold text-muted cursor-pointer flex items-center gap-1.5">
                <Lightbulb size={14} /> {tr("How this works")}
              </summary>
              <p className="text-sm text-ink leading-relaxed mt-1.5">{current.instructionText}</p>
            </details>
          ) : (
            <div className="flex items-start gap-3 bg-paper-warm/70 border border-rule rounded-card px-4 py-3">
              <span className="h-8 w-8 rounded-full bg-navy/15 text-navy-deep flex items-center justify-center shrink-0">
                <Lightbulb size={16} />
              </span>
              <div className="flex flex-col">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("How this works")}</span>
                <p className="text-sm text-ink leading-relaxed">{current.instructionText}</p>
              </div>
            </div>
          )}

      {current.inputMethod === "two-phase" ? (
        <TwoPhaseTask
          stage={twoPhaseStage}
          readSeconds={current.twoPhaseReadSeconds ?? DEFAULT_TWO_PHASE_READ_SECONDS}
          writeSeconds={current.twoPhaseWriteSeconds ?? null}
          readLeft={readLeft}
          passage={getVisibleText(current)}
          answerText={answerText}
          onAnswerTextChange={setAnswerText}
          onStart={handleStartReading}
        />
      ) : needsAudioFirst ? (
        // Mic answers pair naturally side by side with Play (two small
        // round controls). A typed/selected answer is a wide control, so
        // forcing it next to a small round button looked cramped — that
        // case stacks instead: Play centered above, full-width answer below.
        // Mic: two equal columns, so the full-width record control can't squeeze Play.
        <div className={current.inputMethod === "mic" ? "grid grid-cols-2 items-start gap-6" : "flex flex-col gap-4"}>
          <div className={`flex flex-col items-center gap-3 ${current.inputMethod === "mic" ? "" : "self-center"}`}>
            <button
              onClick={handlePlay}
              disabled={playing || recording}
              className={`h-14 w-14 rounded-full bg-${primarySkill} text-lime btn-shine flex items-center justify-center shadow-[0_8px_18px_-8px_rgba(0,0,0,0.3)] transition-transform hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 cursor-pointer disabled:cursor-not-allowed`}
            >
              <Volume2 size={22} />
            </button>
            <span className="text-sm font-medium text-muted whitespace-nowrap">
              {playing ? t("placementTest.playing") : hasPlayed ? t("placementTest.playAgain") : t("placementTest.play")}
            </span>
          </div>
          <AnswerInputControl
            item={current}
            answerText={answerText}
            onAnswerTextChange={setAnswerText}
            recording={recording}
            onToggleRecord={handleToggleRecord}
            audioBlobUrl={audioBlobUrl}
            needsAudioFirst={needsAudioFirst}
            hasPlayed={hasPlayed}
            playing={playing}
            stopIconSize={18}
            textareaRows={4}
          />
        </div>
      ) : getPassageAndQuestion(current) ? (
        <>
          <div className="flex flex-col gap-2.5">
            <p
              className="text-sm text-ink bg-paper-warm rounded-card border-l-4 p-4 whitespace-pre-wrap leading-relaxed shadow-sm"
              style={{ borderLeftColor: `var(--color-${(meta?.skills ?? current.skills)[0]})` }}
            >
              {getPassageAndQuestion(current)!.passage}
            </p>
            <p className="text-sm font-semibold text-ink px-1">{getPassageAndQuestion(current)!.question}</p>
          </div>
          <AnswerInputControl
            item={current}
            answerText={answerText}
            onAnswerTextChange={setAnswerText}
            recording={recording}
            onToggleRecord={handleToggleRecord}
            audioBlobUrl={audioBlobUrl}
            needsAudioFirst={needsAudioFirst}
            hasPlayed={hasPlayed}
            playing={playing}
            stopIconSize={18}
            textareaRows={4}
          />
        </>
      ) : (
        <>
          <p
            className="text-sm text-ink bg-paper-warm rounded-card border-l-4 p-4 leading-relaxed shadow-sm"
            style={{ borderLeftColor: `var(--color-${(meta?.skills ?? current.skills)[0]})` }}
          >
            {visibleText}
          </p>
          <AnswerInputControl
            item={current}
            answerText={answerText}
            onAnswerTextChange={setAnswerText}
            recording={recording}
            onToggleRecord={handleToggleRecord}
            audioBlobUrl={audioBlobUrl}
            needsAudioFirst={needsAudioFirst}
            hasPlayed={hasPlayed}
            playing={playing}
            stopIconSize={18}
            textareaRows={4}
          />
        </>
      )}

          {remainingSeconds === 0 && !feedback && <p className="text-sm text-warning text-center">{tr("Time's up. Submit what you have, or skip.")}</p>}
          </div>
          {feedback && (
            <>
              <AnswerFeedback item={current} feedback={feedback} />
              {feedback.status === "pending" && (
                <p className="text-xs text-muted text-center -mt-2">{tr("You can go on: it will also be in your results at the end of the set.")}</p>
              )}
            </>
          )}
          {error && <p className="text-sm text-error text-center">{error}</p>}
        </div>

        <div
          className={`shrink-0 border-t border-rule flex items-center gap-3 ${small ? "sticky bottom-0 z-10 bg-surface rounded-b-card px-4 py-3" : "px-8 py-4"}`}
          style={small ? { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" } : undefined}
        >
          {feedback ? (
            <Button onClick={() => finishOrAdvance()} className="flex-1">
              {index + 1 < items.length ? tr("Next question") : t("placementTest.finish")}
            </Button>
          ) : (
          <>
          <Button variant="secondary" onClick={handleBack} disabled={index === 0 || submitting || recording || !!context?.check} className="!px-3.5">
            <ArrowLeft size={20} />
          </Button>
          <button
            onClick={handleSkip}
            disabled={submitting || recording}
            className="text-sm font-medium text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed px-1"
          >
            {t("placementTest.skip")}
          </button>
          {/* Needs an answer, except once the question's time has run out: then
              it moves on like Skip (the question counts as skipped). */}
          <Button onClick={canSubmit ? handleSubmit : handleSkip} disabled={submitting || recording || (!canSubmit && remainingSeconds !== 0)} className="flex-1">
            {submitting ? t("placementTest.submitting") : context?.check || items.length > index + 1 ? t("placementTest.next") : t("placementTest.finish")}
          </Button>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

// Under a finished set's score: how far through the level, the streak, and
// any badge earned with this set.
function SetDoneStrip({ summary }: { summary: PracticeSummary }) {
  const progress = summary.unitProgress;
  const badges = summary.newBadges ?? [];
  if (!progress && !summary.streakDays && !badges.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {progress && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-semibold text-ink">{tr("Set {{done}} of {{total}} done in {{level}}", { done: progress.done, total: progress.total, level: progress.unitName })}</span>
            <span>{Math.round((progress.done / Math.max(1, progress.total)) * 100)}%</span>
          </div>
          <div className="h-2 rounded-pill bg-rule overflow-hidden">
            <div className="h-full rounded-pill bg-success transition-all duration-700" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!!summary.streakDays && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-pill bg-warning/15 text-ink">
            <Flame size={14} className="text-warning" /> {tr("{{n}}-day streak", { n: summary.streakDays })}
          </span>
        )}
        {badges.map((b) => (
          <span key={b.id} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-pill bg-navy/10 text-navy-deep animate-[pulse_1.2s_ease-in-out_2]">
            <Award size={14} /> {tr("Badge unlocked: {{name}}", { name: b.title })}
          </span>
        ))}
      </div>
    </div>
  );
}
