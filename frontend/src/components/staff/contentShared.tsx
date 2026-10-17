import { CheckCircle2, XCircle } from "lucide-react";
import type { ContentItem } from "@/api/content";
import { tr } from "@/i18n/tr";

// Shared by the Question bank's tabs: labels and how a question is shown.

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export const CHECK_LABEL: Record<string, () => string> = {
  schema: () => tr("Format"),
  key: () => tr("Answer key (blind check)"),
  level: () => tr("Level"),
  sensitivity: () => tr("Sensitivity and bias"),
  clarity: () => tr("Clarity"),
  duplicate: () => tr("Near-duplicates"),
  audio: () => tr("Recording"),
  review: () => tr("Level, sensitivity and clarity"),
};

export const DOMAIN_LABEL: Record<string, () => string> = {
  general: () => tr("General"),
  banking: () => tr("Banking"),
  bpo: () => tr("BPO and customer support"),
  it: () => tr("IT"),
  insurance: () => tr("Insurance"),
  healthcare: () => tr("Healthcare"),
};

function correctIndexes(item: ContentItem): number[] {
  const a = item.answerSet ?? {};
  if (typeof a.correctIndex === "number") return [a.correctIndex];
  return Array.isArray(a.correct) ? (a.correct as number[]) : [];
}

function Options({ options, correct }: { options: string[]; correct: number | undefined }) {
  return (
    <ol className="flex flex-col gap-1 mt-1">
      {options.map((o, i) => (
        <li key={i} className={`text-sm flex gap-2 ${i === correct ? "text-success font-semibold" : "text-ink"}`}>
          <span className="font-mono text-xs mt-0.5">{String.fromCharCode(65 + i)}</span>
          {o}
          {i === correct && <CheckCircle2 size={14} className="mt-0.5 shrink-0" />}
        </li>
      ))}
    </ol>
  );
}

// The question as a reviewer reads it: script or text, questions, options with the key marked.
export function ItemView({ item }: { item: ContentItem }) {
  const c = item.content as Record<string, unknown>;
  const key = correctIndexes(item);
  const main = (c.audio ?? c.dialogue ?? c.story ?? c.passage ?? c.text ?? c.sentence ?? c.situation ?? c.prompt) as string | undefined;
  return (
    <div className="flex flex-col gap-3">
      {main && (
        <div>
          <span className="text-[11px] uppercase tracking-wide text-muted">{c.audio || c.dialogue || c.story ? tr("Recording script") : c.prompt || c.situation ? tr("Task") : tr("Text")}</span>
          <p className="text-sm text-ink whitespace-pre-wrap bg-paper-warm rounded-input p-3 mt-1">{main}</p>
        </div>
      )}
      {typeof c.question === "string" && <p className="text-sm font-semibold text-ink">{c.question}</p>}
      {Array.isArray(c.options) && <Options options={c.options as string[]} correct={key[0]} />}
      {Array.isArray(c.questions) &&
        (c.questions as { stem?: string; options: string[] }[]).map((q, i) => (
          <div key={i}>
            <p className="text-sm font-semibold text-ink">
              {i + 1}. {q.stem ?? tr("Gap ({{n}})", { n: i + 1 })}
            </p>
            <Options options={q.options ?? []} correct={key[i]} />
          </div>
        ))}
      {Array.isArray(c.groups) && <p className="text-sm text-ink">{(c.groups as string[]).join(" / ")}</p>}
      {Array.isArray(c.ideas) && (
        <ul className="list-disc pl-5 text-sm text-ink">
          {(c.ideas as string[]).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {Array.isArray(c.points) && (
        <ul className="list-disc pl-5 text-sm text-ink">
          {(c.points as string[]).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {item.audio && item.audio.length > 0 && (
        <div className="flex flex-col gap-1">
          {item.audio.map((a) => (
            <div key={a.voice} className="flex items-center gap-2 text-xs text-muted">
              <span className="w-28">
                {a.voice === "male" ? tr("Man's voice first") : tr("Woman's voice first")} · {a.accent} · {a.seconds} s
              </span>
              <audio controls src={a.uri} className="h-8" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChecksView({ checks }: { checks: ContentItem["checks"] }) {
  if (!checks) return <p className="text-xs text-muted">{tr("No automatic checks (added before the pipeline).")}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {Object.entries(checks).map(([name, c]) => (
        <li key={name} className="text-xs flex items-start gap-1.5">
          {c.ok ? <CheckCircle2 size={14} className="text-success shrink-0" /> : <XCircle size={14} className="text-error shrink-0" />}
          <span className="text-ink">
            <span className="font-semibold">{CHECK_LABEL[name]?.() ?? name}</span>
            {typeof c.estimate === "string" && ` · ${c.estimate}`}
            {typeof c.similarity === "number" && ` · ${Math.round((c.similarity as number) * 100)}%`}
            {(c.notes ?? []).length > 0 && <span className="text-muted"> — {(c.notes ?? []).join("; ")}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// The AI service's error in plain words.
export function aiErrorText(error: string): string {
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(error)) return tr("The AI's daily limit is used up. Try again tomorrow, or move the Gemini key to a paid plan.");
  if (/503|UNAVAILABLE|high demand|overloaded/i.test(error)) return tr("The AI was busy. Try again in a few minutes.");
  if (/timed? ?out/i.test(error)) return tr("The AI took too long. Try again.");
  return tr("The AI couldn't write these questions. Try again.");
}
