import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { useTranslation } from "react-i18next";
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
} from "lucide-react";
import { LearnerHero, SKILL_COLOR } from "@/components/learner/LearnerHero";
import { ROUTES } from "@/constants/routes";
import { Button } from "@/components/Button";
import { ProgressRing } from "@/components/ProgressRing";
import { SKILL_TINT_CLASSES, SKILL_RING_COLOR } from "@/lib/skillTints";
import {
  getAvailability,
  getUnits,
  getSets,
  startPracticeSession,
  getCurrentPracticeSession,
  getPracticeSession,
  submitPracticeAttempt,
  completePracticeSession,
  type PracticeSummary,
  type SkillAvailability,
  type PracticeUnit,
  type PracticeSet,
} from "@/api/practiceSession";
import type { TestItem, SkillTag } from "@/api/testSession";
import { useVoiceRecorder, blobToBase64 } from "@/hooks/useVoiceRecorder";
import { playSpokenAudio } from "@/lib/playSpokenAudio";
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
        eyebrow={t("nav.modules")}
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
function TypePicker({ skill, starting, onBack, onSelect }: { skill: SkillTag; starting: boolean; onBack: () => void; onSelect: (typeId: string) => void }) {
  const { t } = useTranslation();
  const Icon = SKILL_ICONS[skill];
  const types = SKILL_TYPES[skill];

  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        onBack={onBack}
        backLabel={t("modules.backToSkills")}
        eyebrow={tr("{{length}} question types", { length: types.length })}
        title={`${t(`skills.${skill}`)} Practice`}
        subtitle={t("modules.pickTypeSubtitle")}
        icon={Icon}
        compact
      />

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
              <span className="mt-auto flex items-center gap-1 text-xs font-semibold text-navy-deep">
                {tr("Practise")}{" "}<ChevronRight size={14} className="transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Shown only if the picked type has units — types without any skip straight to the old count-based start.
function UnitPicker({
  units,
  loading,
  onBack,
  onSelect,
}: {
  units: PracticeUnit[];
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
                  <div className="font-display font-bold text-base text-ink">{unit.name}</div>
                  <div className="text-xs text-muted mt-0.5">
                    {done ? t("modules.unitComplete") : t("modules.setsProgress", { done: unit.completedCount, total: unit.setCount })}
                  </div>
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
  onSelect: (setId: string) => void;
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
              onClick={() => onSelect(set.id)}
              className="group text-left flex items-center gap-4 bg-surface border border-rule rounded-card p-6 transition-all cursor-pointer hover:border-rule-strong hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-14px_rgba(0,0,0,0.28)]"
            >
              <span
                className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 font-display font-bold text-lg transition-transform group-hover:scale-110 ${
                  set.completed ? "bg-success/15 text-success" : "bg-accent/15 text-accent"
                }`}
              >
                {set.completed ? <CheckCircle2 size={22} /> : i + 1}
              </span>
              <span className="flex-1 text-base font-semibold text-ink">{set.name}</span>
              {set.completed ? (
                <span className="text-xs font-semibold text-success shrink-0">{t("modules.setCompleted")}</span>
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
  const [pendingStart, setPendingStart] = useState<{ skill: SkillTag; count?: number; itemTypeId?: string; setId?: string } | null>(
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
    function applyResumedSession(res: { sessionId: string; items: TestItem[] }) {
      setSessionId(res.sessionId);
      setItems(res.items);
      const firstUnattempted = res.items.findIndex((item) => !item.attempted);
      setIndex(firstUnattempted === -1 ? 0 : firstUnattempted);
      setAnswers(
        Object.fromEntries(
          res.items.flatMap((item, i) => (item.attempted ? [[i, { responseText: item.responseText ?? "" }]] : [])),
        ),
      );
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
  // Stops once the score report shows — nothing left to verify identity
  // against after the test is already complete.
  usePeriodicFaceCheck(Boolean(sessionId) && !summary && !requireReverify, "practice", sessionId, () => setRequireReverify(true));
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // Gates the first question behind the type's real instruction_text (how
  // this task works) on a genuinely fresh start — not shown again when
  // resuming a session already partway through, since that'd already been seen.
  const [showTypeIntro, setShowTypeIntro] = useState(false);
  // "two-phase" items (Passage Reconstruction): show the passage, then hide
  // it and switch to a blank textarea — testing recall, not copying.
  const [twoPhaseStage, setTwoPhaseStage] = useState<"idle" | "reading" | "writing">("idle");
  const twoPhaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getAvailability()
      .then((res) => setAvailability(res.availability))
      .catch(() => setAvailability(null))
      .finally(() => setLoadingAvailability(false));
  }, []);

  async function handleStart(skill: SkillTag, count?: number, itemTypeId?: string, setId?: string) {
    setStarting(true);
    setError(null);
    try {
      const res = await startPracticeSession(skill, count, itemTypeId, setId);
      setSessionId(res.sessionId);
      setItems(res.items);
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
      setShowTypeIntro(res.items.every((item) => !item.attempted));
    } catch {
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
    const raw = `${searchParams.get("skill")}|${searchParams.get("type")}|${searchParams.get("count")}`;
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
      if (itemTypeId) {
        setPendingStart({ skill, count: count ? Number(count) : undefined, itemTypeId });
      } else {
        setPendingStart(null);
        setPickerSkill(skill);
      }
    }
  }, [searchParams]);

  const current = items[index];
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

  // Live countdown, display-only (mirrors PlacementTest.tsx) — doesn't gate
  // or auto-submit anything.
  useEffect(() => {
    if (!current?.timerSeconds) {
      setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds(current.timerSeconds);
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current?.timerSeconds]);

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
    await playSpokenAudio(current, getSpokenSegments(current));
    setPlaying(false);
    setHasPlayed(true);
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
      await submitPracticeAttempt(sessionId, {
        itemId: current.id,
        responseText: answerText.trim() || undefined,
        audioBase64: pendingAudio?.base64,
        audioMimeType: pendingAudio?.mimeType,
        durationMs: recordingDurationMs ?? undefined,
        activeMs: Date.now() - questionShownAtRef.current,
      });
      cacheCurrentAnswer();
      await finishOrAdvance();
    } catch {
      setError(t("placementTest.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (!current || !sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPracticeAttempt(sessionId, { itemId: current.id, activeMs: Date.now() - questionShownAtRef.current });
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
    if (index === 0) return;
    cacheCurrentAnswer();
    setIndex(index - 1);
  }

  function resetToPicker() {
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
      const { skill, count, itemTypeId, setId } = pendingStart;
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
            handleStart(skill, count, itemTypeId, setId);
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
          onSelect={(setId) => {
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
    return (
      <div className="max-w-lg mx-auto bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-5 items-center text-center">
        <div className="h-14 w-14 rounded-full bg-navy text-lime flex items-center justify-center">
          <CheckCircle2 size={32} />
        </div>
        <h1 className="font-display font-bold text-2xl text-ink">{t("modules.sessionComplete")}</h1>
        <p className="text-sm text-muted">
          {t("placementTest.resultsSummary", {
            correct: summary.correctCount,
            graded: summary.gradedCount,
            pending: summary.pendingCount,
          })}
        </p>
        {summary.failedCount > 0 && (
          <p className="text-sm text-error">{t("placementTest.failedNote", { failed: summary.failedCount })}</p>
        )}
        <div className="flex items-center gap-3 w-full">
          <Button variant="secondary" onClick={resetToPicker} className="flex-1">
            {t("modules.practiceAgain")}
          </Button>
          <Button onClick={() => navigate(ROUTES.DASHBOARD)} className="flex-1">
            {t("modules.backToDashboard")}
          </Button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  if (showTypeIntro) {
    const typeMeta = ITEM_TYPE_META[current.itemTypeId];
    const TypeIntroIcon = ITEM_TYPE_ICON[current.itemTypeId] ?? Headphones;
    return (
      <div className="max-w-lg mx-auto bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-5 items-center text-center">
        <span className="h-14 w-14 rounded-2xl bg-navy/15 text-navy-deep flex items-center justify-center">
          <TypeIntroIcon size={26} strokeWidth={2} />
        </span>
        <div>
          <h1 className="font-display font-bold text-xl text-ink">{typeMeta?.name}</h1>
          <p className="text-sm text-muted mt-2 leading-relaxed">{current.instructionText}</p>
        </div>
        <Button onClick={() => setShowTypeIntro(false)} className="w-full">
          {t("modules.startPractice")}
        </Button>
      </div>
    );
  }

  // A mic answer is submittable once there's a saved recording, whether or
  // not live transcription produced any text — an empty transcript falls
  // through to pending/manual review server-side, rather than blocking
  // submission entirely.
  const canSubmit = current.inputMethod === "mic" ? !recording && !!audioBlobUrl : answerText.trim() !== "";
  const progressPct = Math.round((index / items.length) * 100);
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
        className="relative w-full bg-surface border border-rule rounded-card shadow-sm overflow-hidden flex flex-col"
        style={{ minHeight: "420px", maxHeight: "min(780px, calc(100vh - 180px))" }}
      >
        {/* A light skill-tinted wash across the whole card (not just an
            icon badge) — distinct from Practice Tests' navy/cream
            "You hear / You say" panels, giving Modules its own, friendlier
            identity instead of reusing the same visual language. */}
        <span className={`absolute inset-0 pointer-events-none ${SKILL_WASH_CLASSES[primarySkill]}`} />
        <div className="relative flex-1 p-8 pt-6 flex flex-col justify-start gap-5 overflow-y-auto">
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
                  <span className="text-[11px] font-mono text-muted">
                    {t("placementTest.progress", { current: index + 1, total: items.length })}
                  </span>
                </div>
              </div>
              {remainingSeconds !== null ? (
                <span
                  className={`flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1 rounded-pill border transition-colors ${
                    remainingSeconds <= 5 ? "text-error border-error/30 bg-error/10" : "text-navy-deep border-navy/20 bg-navy/10"
                  }`}
                >
                  <Clock size={16} />
                  {String(Math.floor(remainingSeconds / 60)).padStart(1, "0")}:{String(remainingSeconds % 60).padStart(2, "0")}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
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

          {/* The real task explanation ("Listen to the conversation and
              answer the question."), not the short per-item prompt — shown
              as a proper heading every time, not just once in the one-time
              type intro, so it's never just the vague "Answer the
              question." with no context. */}
          <h2 className="font-display font-bold text-base text-ink leading-snug">{current.instructionText}</h2>

      {current.inputMethod === "two-phase" ? (
        <>
          {twoPhaseStage === "idle" ? (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={handleStartReading}>
                {t("modules.startReading")}
              </Button>
            </div>
          ) : twoPhaseStage === "reading" ? (
            <p
              className="text-sm text-ink bg-paper-warm rounded-card border-l-4 p-4 leading-relaxed shadow-sm"
              style={{ borderLeftColor: `var(--color-${(meta?.skills ?? current.skills)[0]})` }}
            >
              {getVisibleText(current)}
            </p>
          ) : (
            <p className="text-sm text-muted italic text-center">{t("modules.passageHidden")}</p>
          )}
          {twoPhaseStage === "writing" && (
            <textarea
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
              placeholder={t("placementTest.answerPlaceholder")}
              className="w-full rounded-card border border-rule bg-surface px-4 py-3 text-sm text-ink shadow-sm focus:border-navy focus:outline-none transition-colors"
              rows={4}
            />
          )}
        </>
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

          {error && <p className="text-sm text-error text-center">{error}</p>}
        </div>

        <div className="shrink-0 border-t border-rule px-8 py-4 flex items-center gap-3">
          <Button variant="secondary" onClick={handleBack} disabled={index === 0 || submitting || recording} className="!px-3.5">
            <ArrowLeft size={20} />
          </Button>
          <button
            onClick={handleSkip}
            disabled={submitting || recording}
            className="text-sm font-medium text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed px-1"
          >
            {t("placementTest.skip")}
          </button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="flex-1">
            {submitting ? t("placementTest.submitting") : index + 1 < items.length ? t("placementTest.next") : t("placementTest.finish")}
          </Button>
        </div>
      </div>
    </div>
  );
}
