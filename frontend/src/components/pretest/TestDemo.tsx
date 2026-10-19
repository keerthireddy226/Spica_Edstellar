import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  Headphones,
  Hourglass,
  Lightbulb,
  Mic,
  Monitor,
  MousePointerClick,
  Play,
  Square,
  ThumbsDown,
  ThumbsUp,
  VolumeX,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/Button";
import { speak } from "@/hooks/useVoiceRecorder";
import { demoSeen, markDemoSeen, setDemoHidden, type DeviceNeeds } from "@/lib/systemCheck";
import { tr } from "@/i18n/tr";

type Skill = "speaking" | "listening" | "reading" | "writing";

// Which skills each test covers, so only the relevant tips show.
function skillsFor(kind: string): Skill[] {
  if (kind === "speakingListening") return ["speaking", "listening"];
  if (kind === "writing") return ["listening", "reading", "writing"];
  return ["speaking", "listening", "reading", "writing"];
}

const SKILL_LABEL: Record<Skill, () => string> = {
  speaking: () => tr("Speaking"),
  listening: () => tr("Listening"),
  reading: () => tr("Reading"),
  writing: () => tr("Writing"),
};

const SKILL_TIPS: Record<Skill, () => string[]> = {
  speaking: () => [
    tr("Press Record, then speak clearly at a normal pace."),
    tr("Give full answers. Very short or silent answers score low."),
    tr("Keep the microphone at the same distance the whole time."),
  ],
  listening: () => [
    tr("Each audio can only be played a limited number of times. Listen carefully the first time."),
    tr("Headphones help you hear every word."),
  ],
  reading: () => [tr("Read the whole text before you answer."), tr("When a passage disappears after a short time, read it carefully while it's on screen.")],
  writing: () => [
    tr("Check your grammar, spelling and punctuation before you save."),
    tr("Don't write in all capital letters."),
    tr("Include as many details as you can. Don't copy the prompt."),
  ],
};

type TourSpot = "part" | "progress" | "timer" | "play" | "answer" | "next";

const STEP_TITLES = [() => tr("What you need"), () => tr("Do's and don'ts"), () => tr("Tips for each section"), () => tr("How the test screen works")];

// A short, skippable walkthrough before a test: what to have ready, the
// rules, tips per section, and a guided tour of the real question screen.
export function TestDemo({
  kind,
  needs,
  minutes,
  onDone,
  doneLabel,
}: {
  kind: string;
  needs: DeviceNeeds;
  minutes?: string | null;
  onDone: () => void;
  doneLabel?: string;
}) {
  const [step, setStep] = useState(0);
  // Offered once the learner has seen the demo before.
  const [canHide] = useState(() => demoSeen());
  const [hide, setHide] = useState(false);
  const last = STEP_TITLES.length - 1;

  function finish() {
    markDemoSeen();
    if (hide) setDemoHidden(true);
    onDone();
  }

  return (
    <div className="max-w-3xl mx-auto bg-surface border border-rule rounded-card shadow-sm p-6 sm:p-8 flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Test demo · {{n}} of {{total}}", { n: step + 1, total: STEP_TITLES.length })}</p>
          <h1 className="font-display font-bold text-xl text-ink mt-1">{STEP_TITLES[step]()}</h1>
        </div>
        <button onClick={finish} className="text-sm font-semibold text-muted hover:text-ink cursor-pointer shrink-0 underline-offset-4 hover:underline">
          {tr("Skip demo")}
        </button>
      </div>

      <div className="flex gap-1.5" aria-hidden>
        {STEP_TITLES.map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-pill ${i <= step ? "bg-navy" : "bg-paper-warm"}`} />
        ))}
      </div>

      {step === 0 && <NeedsStep needs={needs} minutes={minutes} />}
      {step === 1 && <RulesStep />}
      {step === 2 && <TipsStep skills={skillsFor(kind)} />}
      {step === 3 && <TourStep speaking={skillsFor(kind).includes("speaking")} total={kind === "placement" ? 29 : undefined} />}

      {canHide && (
        <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="h-4 w-4 accent-[var(--color-navy)]" />
          {tr("Don't show the demo before my tests again")}
        </label>
      )}

      <div className="flex items-center gap-3">
        {step > 0 && (
          <Button variant="secondary" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={15} className="inline mr-1.5" />
            {tr("Back")}
          </Button>
        )}
        <Button className="ml-auto" onClick={() => (step === last ? finish() : setStep(step + 1))}>
          {step === last ? (doneLabel ?? tr("I'm ready, start the test")) : tr("Next")}
          {step !== last && <ArrowRight size={15} className="inline ml-1.5" />}
        </Button>
      </div>
    </div>
  );
}

function NeedCard({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 p-4">
      <span className="h-20 w-20 rounded-full border-4 border-accent/25 bg-accent/10 text-navy-deep flex items-center justify-center">{icon}</span>
      <p className="text-sm text-ink leading-snug">{text}</p>
    </div>
  );
}

function NeedsStep({ needs, minutes }: { needs: DeviceNeeds; minutes?: string | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      <NeedCard icon={<Wifi size={32} />} text={tr("A computer with a stable internet connection.")} />
      <NeedCard
        icon={<Headphones size={32} />}
        text={needs.mic ? tr("Headphones and a microphone. A headset is best.") : tr("Headphones or speakers. A microphone is not needed for this test.")}
      />
      <NeedCard icon={<VolumeX size={32} />} text={tr("A quiet room without distractions. Even a fan can be noisy.")} />
      <NeedCard
        icon={<Hourglass size={32} />}
        text={minutes ? tr("About {{m}} minutes. Finish the test in one sitting.", { m: minutes }) : tr("Enough time to finish the test in one sitting.")}
      />
    </div>
  );
}

function RuleList({ good, items }: { good: boolean; items: { icon: ReactNode; text: string }[] }) {
  return (
    <div className={`rounded-card p-5 flex flex-col gap-3 ${good ? "bg-success/10" : "bg-error/10"}`}>
      <p className={`flex items-center gap-2 font-semibold text-sm ${good ? "text-success" : "text-error"}`}>
        {good ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />}
        {good ? tr("Do") : tr("Don't")}
      </p>
      <ul className="flex flex-col gap-2.5">
        {items.map((it) => (
          <li key={it.text} className="flex items-start gap-2.5 text-sm text-ink">
            <span className={`shrink-0 mt-0.5 ${good ? "text-success" : "text-error"}`}>{it.icon}</span>
            {it.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RulesStep() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <RuleList
          good
          items={[
            { icon: <Monitor size={16} />, text: tr("Stay on the test tab until you finish.") },
            { icon: <Eye size={16} />, text: tr("Keep your face in view of the camera, in good light.") },
            { icon: <VolumeX size={16} />, text: tr("Sit alone in a quiet room.") },
            { icon: <CheckCircle2 size={16} />, text: tr("Answer every question. Skip one only if you're stuck.") },
          ]}
        />
        <RuleList
          good={false}
          items={[
            { icon: <Ban size={16} />, text: tr("Switch to other tabs, windows or apps.") },
            { icon: <Copy size={16} />, text: tr("Copy or paste. Both are turned off during the test.") },
            { icon: <Square size={16} />, text: tr("Take screenshots or record the screen.") },
            { icon: <Ban size={16} />, text: tr("Use a phone, notes, or help from anyone else.") },
          ]}
        />
      </div>
      <p className="text-xs text-muted leading-relaxed">
        {tr(
          "Leaving the tab, pasting, screenshot keys and camera problems are recorded and may be reviewed after the test. You'll see a warning on screen when something is recorded. Taking screenshots or photos of the questions breaks the test rules even when it isn't detected. If your connection drops or the page closes, open the test again: your saved answers stay.",
        )}
      </p>
    </div>
  );
}

function TipsStep({ skills }: { skills: Skill[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {skills.map((s) => (
        <div key={s} className="border border-rule rounded-card p-5 flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `var(--color-${s})` }} />
            {SKILL_LABEL[s]()}
          </p>
          <ul className="flex flex-col gap-2">
            {SKILL_TIPS[s]().map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-ink">
                <Lightbulb size={15} className="text-warning shrink-0 mt-0.5" /> {t}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const TOUR_ORDER: TourSpot[] = ["part", "progress", "timer", "play", "answer", "next"];

function tourText(spot: TourSpot, mic: boolean): string {
  switch (spot) {
    case "part":
      return tr("The part of the test you're in. Each part opens with a short screen that explains the task.");
    case "progress":
      return tr("Your question number, the Test ID and the Attempt ID. Quote the Attempt ID if you contact support.");
    case "timer":
      return tr("How long to spend on this question. Try to answer before it reaches 0:00.");
    case "play":
      return tr("Plays the question. You can play it only a limited number of times, so listen carefully. Try it.");
    case "answer":
      return mic
        ? tr("Press to start recording and press again to stop. You can listen back before you save. Try it.")
        : tr("Type your answer here. Copy and paste are turned off.");
    case "next":
      return tr("Save and Next keeps your answer and moves on. Skip leaves the question unanswered.");
  }
}

// The question screen as learners see it, with one control highlighted at a time.
// The sample is a spoken question for tests with speaking, a typed one otherwise.
function TourStep({ speaking, total }: { speaking: boolean; total?: number }) {
  const [i, setI] = useState(0);
  const [recording, setRecording] = useState(false);
  const [plays, setPlays] = useState(0);
  const spot = TOUR_ORDER[i];

  const mark = (s: TourSpot) =>
    s === spot ? "relative z-10 ring-4 ring-accent ring-offset-2 ring-offset-surface transition-all" : "opacity-35 transition-all";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-paper rounded-card p-4 flex flex-col gap-3 select-none" aria-label={tr("Sample question screen")}>
        <div className="flex items-center justify-between gap-2 px-1">
          <span className={`flex items-center gap-2 rounded-pill pr-2 ${mark("part")}`}>
            <span className="h-6 w-6 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold">A</span>
            <span className="text-xs font-semibold text-ink">{speaking ? tr("Repeats") : tr("Dictation")}</span>
          </span>
          <span className={`text-xs font-mono text-muted rounded-pill px-2 py-0.5 ${mark("progress")}`}>
            {/* A sample: no real test ID, and the level test's real length. */}
            {total ? tr("Question 1 of {{n}}", { n: total }) : tr("Question 1")}
          </span>
        </div>

        <div className="relative bg-surface border border-rule rounded-card overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-1.5" style={{ backgroundColor: `var(--color-${speaking ? "speaking" : "listening"})` }} />
          <div className="p-6 pt-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wide text-ink font-semibold">{speaking ? tr("Repeats") : tr("Dictation")}</span>
              <span className={`flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1 rounded-pill border text-navy-deep border-navy/20 bg-navy/10 ${mark("timer")}`}>
                <Clock size={14} /> 0:15
              </span>
            </div>
            <p className="text-sm text-muted">
              {speaking ? tr("Listen to the sentence, then repeat it exactly.") : tr("Listen to the sentence, then type exactly what you hear.")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                disabled={spot !== "play" || plays >= 2}
                onClick={() => {
                  setPlays((p) => p + 1);
                  speak([tr("The meeting starts at ten o'clock.")]);
                }}
                className={`flex-1 flex items-center justify-center gap-2 rounded-input border border-rule bg-paper-warm py-4 text-sm font-semibold text-ink disabled:cursor-default ${mark("play")}`}
              >
                <Play size={16} /> {tr("Play audio")} <span className="text-xs text-muted font-normal">({tr("{{n}} plays left", { n: 2 - plays })})</span>
              </button>
              {speaking ? (
                <button
                  type="button"
                  disabled={spot !== "answer"}
                  onClick={() => setRecording((r) => !r)}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-input py-4 text-sm font-semibold disabled:cursor-default ${
                    recording ? "bg-error text-white" : "bg-navy text-lime"
                  } ${mark("answer")}`}
                >
                  {recording ? <Square size={14} className="fill-current" /> : <Mic size={16} />}
                  {recording ? tr("Stop recording") : tr("Record your answer")}
                </button>
              ) : (
                <div className={`flex-1 rounded-input border border-rule bg-surface px-3 py-4 text-sm text-muted ${mark("answer")}`}>{tr("Type your answer...")}</div>
              )}
            </div>
          </div>
          <div className="border-t border-rule px-6 py-3 flex items-center gap-3">
            <span className={`flex items-center gap-3 flex-1 rounded-pill ${mark("next")}`}>
              <span className="text-sm font-semibold text-muted px-3">{tr("Skip")}</span>
              <span className="flex-1 text-center rounded-pill bg-navy text-lime text-sm font-semibold py-2">{tr("Save and Next")}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 bg-accent/10 border border-accent/30 rounded-card p-4">
        <MousePointerClick size={18} className="text-navy-deep shrink-0 mt-0.5" />
        <p className="text-sm text-ink flex-1">{tourText(spot, speaking)}</p>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setI(Math.max(0, i - 1))}
            disabled={i === 0}
            aria-label={tr("Previous")}
            className="h-8 w-8 rounded-full border border-rule flex items-center justify-center text-ink disabled:opacity-40 cursor-pointer disabled:cursor-default"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-xs font-mono text-muted w-10 text-center">
            {i + 1}/{TOUR_ORDER.length}
          </span>
          <button
            onClick={() => setI(Math.min(TOUR_ORDER.length - 1, i + 1))}
            disabled={i === TOUR_ORDER.length - 1}
            aria-label={tr("Next")}
            className="h-8 w-8 rounded-full border border-rule flex items-center justify-center text-ink disabled:opacity-40 cursor-pointer disabled:cursor-default"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
