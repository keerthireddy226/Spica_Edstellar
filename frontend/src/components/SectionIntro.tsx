import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Hash, Mic, Keyboard, MousePointerClick, Volume2, TrendingUp, Lightbulb } from "lucide-react";
import { tr } from "@/i18n/tr";
import type { TestItem } from "@/api/testSession";
import { AUDIO_FIRST_TYPES, ITEM_TYPE_META, SKILL_BADGE_CLASS } from "@/lib/testItemDisplay";

// The steps a test taker follows in a section, by how its questions are answered.
function steps(item: TestItem, plays: number, timed: boolean): string[] {
  const heard = AUDIO_FIRST_TYPES.has(item.itemTypeId);
  const listen =
    plays === 1
      ? timed
        ? tr("Press Play when you are ready. The recording plays once. If you wait too long, it plays by itself.")
        : tr("Press Play when you are ready. The recording plays once. Listen carefully.")
      : tr("Press Play and listen. You can play the recording twice.");
  const done = timed ? tr("Your answer is saved when you stop or when the time runs out, and the next question opens.") : tr("Then press Next.");
  const next = (timedText: string) => (timed ? timedText : tr("Press Next when you are ready."));
  switch (item.inputMethod) {
    case "mic":
      return heard
        ? [listen, tr("Press the microphone and speak your answer."), tr("Press Stop when you have finished.") + " " + done]
        : [tr("Read the text or task on the screen."), tr("Press the microphone and speak your answer."), tr("Press Stop when you have finished.") + " " + done];
    case "two-phase":
      return [
        tr("Press Start reading. The text stays on screen for {{s}} seconds.", { s: item.twoPhaseReadSeconds ?? 30 }),
        tr("When it disappears, write it again in your own words. Keep the main points."),
        next(tr("Press Next when you are ready. When the time runs out, what you wrote is handed in.")),
      ];
    case "radio":
    case "mcq_group":
      return [heard ? listen : tr("Read the text and the question."), tr("Choose the best answer."), next(tr("Press Next. When the time runs out, your choice is handed in."))];
    case "textarea":
      return [tr("Read the task carefully."), tr("Write your answer in the box, covering every point in the task."), next(tr("Press Next when you are ready. When the time runs out, what you wrote is handed in."))];
    default:
      return heard
        ? [listen, tr("Type exactly what you heard."), next(tr("Press Next. When the time runs out, what you typed is handed in."))]
        : [tr("Read the sentence or question."), tr("Type your answer in the box."), next(tr("Press Next. When the time runs out, what you typed is handed in."))];
  }
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-input border border-rule bg-paper-warm/60 px-3 py-2 text-left">
      <span className="text-navy-deep shrink-0">{icon}</span>
      <span className="text-sm text-ink leading-snug">{children}</span>
    </div>
  );
}

export function SectionIntro({
  item,
  count,
  plays,
  timed,
}: {
  item: TestItem;
  count: number;
  plays: number;
  timed: boolean;
}) {
  const { t } = useTranslation();
  const meta = ITEM_TYPE_META[item.itemTypeId];
  const skills = meta?.skills ?? item.skills;
  const heard = AUDIO_FIRST_TYPES.has(item.itemTypeId);
  const secs = item.limitSeconds ?? null;
  const answerBy =
    item.inputMethod === "mic" ? (
      <>
        <Mic size={16} />
        {tr("You answer by speaking")}
      </>
    ) : item.inputMethod === "radio" || item.inputMethod === "mcq_group" ? (
      <>
        <MousePointerClick size={16} />
        {tr("You answer by choosing an option")}
      </>
    ) : (
      <>
        <Keyboard size={16} />
        {tr("You answer by typing")}
      </>
    );
  return (
    <div className="w-full flex flex-col gap-5 text-left">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Fact icon={<Hash size={16} />}>{tr("{{n}} questions in this section", { n: count })}</Fact>
        {heard && plays === 1 ? (
          <Fact icon={<Clock size={16} />}>{tr("The timer starts when the recording ends")}</Fact>
        ) : timed && secs ? (
          <Fact icon={<Clock size={16} />}>
            {secs >= 120 ? tr("About {{m}} minutes for each question", { m: Math.round(secs / 60) }) : tr("About {{s}} seconds for each question", { s: secs })}
          </Fact>
        ) : (
          <Fact icon={<Clock size={16} />}>{tr("Each question has its own timer")}</Fact>
        )}
        <div className="flex items-center gap-2 rounded-input border border-rule bg-paper-warm/60 px-3 py-2 text-sm text-ink">
          <span className="flex items-center gap-2 [&>svg]:text-navy-deep">{answerBy}</span>
        </div>
        {heard ? (
          <Fact icon={<Volume2 size={16} />}>{plays === 1 ? tr("Each recording plays once") : tr("You can play each recording twice")}</Fact>
        ) : (
          <Fact icon={<TrendingUp size={16} />}>{tr("Questions get harder as you go")}</Fact>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-muted mr-1">{tr("Skills tested:")}</span>
        {skills.map((s) => (
          <span key={s} className={`text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill border ${SKILL_BADGE_CLASS[s]}`}>
            {t(`skills.${s}`)}
          </span>
        ))}
      </div>

      <div className="rounded-card border border-rule p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">{tr("How it works")}</h2>
        <ol className="flex flex-col gap-2.5">
          {steps(item, plays, timed).map((s, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="h-6 w-6 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
              <span className="text-sm text-ink leading-relaxed pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-start gap-2 text-sm text-ink bg-warning/15 border border-warning/40 rounded-input px-3 py-2.5">
        <Lightbulb size={16} className="text-ink shrink-0 mt-0.5" />
        <span>
          {item.inputMethod === "mic"
            ? tr("Speak clearly at a normal pace. Your accent does not matter: you are scored on how clearly you are understood.")
            : tr("Questions start easy and get harder. Answer every question: a blank answer counts as wrong.")}
          {timed && <span className="block mt-1 font-semibold">{tr("You cannot go back to an earlier question.")}</span>}
        </span>
      </div>
    </div>
  );
}
