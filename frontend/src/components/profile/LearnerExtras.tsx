import { useEffect, useState } from "react";
import { Building2, Flame, Mail, Pencil, Target, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/Button";
import { EXAM_FOCUS_LABEL, type ExamFocus } from "@/api/details";
import { getMyLearning, saveMyGoals, type MyLearning } from "@/api/me";
import { shortDate } from "@/api/staff";

import { tr } from "@/i18n/tr";
const card = "bg-surface border border-rule rounded-card p-6 flex flex-col gap-4";
const input = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

function Head({ icon: Icon, tint, title, action }: { icon: typeof Target; tint: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className={`h-9 w-9 rounded-xl flex items-center justify-center ${tint}`}>
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <h2 className="font-display font-bold text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function useMyLearning() {
  const [data, setData] = useState<MyLearning | null>(null);
  const load = () =>
    getMyLearning()
      .then(setData)
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
  return { data, reload: load };
}

// Where they are: level, streak, practice and access.
export function ProgressSnapshot({ data }: { data: MyLearning }) {
  const p = data.progress;
  const a = data.access;
  const daysLeft = a.accessEndsAt ? Math.ceil((new Date(a.accessEndsAt).getTime() - Date.now()) / 86400000) : null;
  const tiles: [string, string | number][] = [
    [tr("Current level"), p.level ?? tr("Not placed yet")],
    [tr("Day streak"), p.streak],
    [tr("Practice sessions"), p.sessions],
    [tr("Minutes practised"), p.minutes],
    [tr("Questions answered"), p.questions],
    [tr("Accuracy"), p.accuracy != null ? `${p.accuracy}%` : "—"],
  ];
  return (
    <div className={card}>
      <Head icon={TrendingUp} tint="bg-accent/15 text-accent" title={tr("Your progress")} />
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(([l, v]) => (
          <div key={l} className="rounded-input bg-paper-warm px-3 py-2.5">
            <p className="font-display font-bold text-xl text-ink">{v}</p>
            <p className="text-[11px] text-muted">{l}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
        <Flame size={14} className="text-warning" />
        {tr("{{xp}} XP", { xp: p.xp })}{p.lastPractice ? tr(" · last practised {{shortDate}}", { shortDate: shortDate(p.lastPractice) }) : ""}
        {p.placedAt ? tr(" · placement {{v}}% on {{shortDate}}", { v: p.placementPercent ?? "", shortDate: shortDate(p.placedAt) }) : ""}
      </div>
      <p className="text-xs text-muted">
        {tr("Access:")}{" "}
        <span className="font-semibold text-ink">
          {a.status === "active" ? `active${daysLeft != null ? tr(" · {{daysLeft}} day{{v}} left", { daysLeft: daysLeft, v: daysLeft === 1 ? "" : "s" }) : ""}` : a.status === "grace" ? tr("in grace period") : a.status === "expired" ? "ended" : tr("free plan")}
        </span>
        {a.accessEndsAt ? ` (until ${shortDate(a.accessEndsAt)})` : ""}
      </p>
    </div>
  );
}

// Their organization, batch, goals for the batch, and who to contact.
export function MyOrganization({ data }: { data: MyLearning }) {
  if (!data.organization) return null;
  const b = data.batch;
  const end = b?.startDate && b.durationMonths ? new Date(new Date(b.startDate).setMonth(new Date(b.startDate).getMonth() + b.durationMonths)).toISOString() : null;
  return (
    <div className={card}>
      <Head icon={Building2} tint="bg-navy/15 text-navy" title={tr("Your organization")} />
      <div>
        <p className="text-sm font-semibold text-ink">{data.organization.name}</p>
        <p className="text-xs text-muted">{data.organization.category === "university" ? tr("University") : tr("Organization")} {tr("· member since {{shortDate}}", { shortDate: shortDate(data.memberSince) })}</p>
      </div>
      {b ? (
        <div className="rounded-input bg-paper-warm px-4 py-3 flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink">{tr("Batch: {{name}}", { name: b.name })}</p>
          {b.description && <p className="text-xs text-muted">{b.description}</p>}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <p>
              <span className="text-muted">{tr("Level goal")}{" "}</span>
              <span className="text-ink font-medium">{b.startCefr || b.targetCefr ? `${b.startCefr ?? "?"} → ${b.targetCefr ?? "?"}` : "—"}</span>
            </p>
            <p>
              <span className="text-muted">{tr("Target score")}{" "}</span>
              <span className="text-ink font-medium">{b.targetCutScore ? `${b.targetCutScore}%` : "—"}</span>
            </p>
            <p>
              <span className="text-muted">{tr("Dates")}{" "}</span>
              <span className="text-ink font-medium">{b.startDate ? `${shortDate(b.startDate)}${end ? ` – ${shortDate(end)}` : ""}` : "—"}</span>
            </p>
            <p>
              <span className="text-muted">{tr("Weekly practice")}{" "}</span>
              <span className="text-ink font-medium">{b.weeklyMinutesGoal ? `${b.weeklyMinutesGoal} min` : "—"}</span>
            </p>
            {b.examFocus && (
              <p className="col-span-2">
                <span className="text-muted">{tr("Preparing for")}{" "}</span>
                <span className="text-ink font-medium">{EXAM_FOCUS_LABEL[b.examFocus as ExamFocus] ?? b.examFocus}</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">{tr("You're not in a batch yet — your Org Admin will add you to one.")}</p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
          <Users size={13} /> {tr("Need help? Contact")}</p>
        {[...(b?.managers ?? []).map((m) => ({ ...m, role: tr("Manager") })), ...(data.organization.orgAdmin ? [{ ...data.organization.orgAdmin, role: tr("Org Admin") }] : [])].map((c) => (
          <a key={c.email + c.role} href={`mailto:${c.email}`} className="flex items-center justify-between gap-3 text-sm hover:bg-paper-warm rounded-input px-2 py-1.5 -mx-2">
            <span className="text-ink">
              {c.name.trim() || c.email} <span className="text-xs text-muted">· {c.role}</span>
            </span>
            <span className="flex items-center gap-1 text-xs text-navy">
              <Mail size={12} /> {c.email}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

const EXAMS: [string, string][] = [
  ["versant", tr("Versant by Pearson")],
  ["ielts", tr("IELTS")],
  ["toefl", tr("TOEFL")],
  ["pte", tr("PTE Academic")],
  ["cambridge", tr("Cambridge English")],
  ["other", tr("Something else")],
];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "unsure"];
const REASONS: [string, string][] = [
  ["job", tr("For my job")],
  ["promotion", tr("For a promotion")],
  ["university", tr("For university")],
  ["immigration", tr("For immigration")],
  ["personal", tr("For myself")],
];

// What they're working towards; editable so the roadmap can follow.
export function LearningGoals({ data, onSaved }: { data: MyLearning; onSaved: () => void }) {
  const g = data.goals;
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState({
    examPreference: g.examPreference ?? "",
    goalLevel: g.goalLevel ?? "",
    scoreTarget: g.scoreTarget ?? "",
    examDate: g.examDate ? g.examDate.slice(0, 10) : "",
    dailyMinutes: g.dailyMinutes ? String(g.dailyMinutes) : "",
    examReason: g.examReason ?? "",
  });
  const [saving, setSaving] = useState(false);
  const days = g.examDate ? Math.ceil((new Date(g.examDate).getTime() - Date.now()) / 86400000) : null;
  const f = (k: keyof typeof d) => ({ value: d[k], onChange: (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value })) });

  return (
    <div className={card}>
      <Head
        icon={Target}
        tint="bg-warning/20 text-navy-deep"
        title={tr("Your learning goals")}
        action={
          !editing && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xs font-semibold text-navy hover:underline cursor-pointer">
              <Pencil size={13} /> {tr("Edit")}</button>
          )
        }
      />
      {!editing ? (
        <div className="grid grid-cols-2 gap-4 text-sm">
          {(
            [
              [tr("Exam"), EXAMS.find(([k]) => k === g.examPreference)?.[1] ?? "—"],
              [tr("Goal level"), g.goalLevel === "unsure" ? tr("Not sure yet") : (g.goalLevel ?? "—")],
              [tr("Target score"), g.scoreTarget || "—"],
              [tr("Exam date"), g.examDate ? `${shortDate(g.examDate)}${days != null && days >= 0 ? tr(" · in {{days}} days", { days: days }) : ""}` : tr("Not booked")],
              [tr("Daily practice"), g.dailyMinutes ? tr("{{n}} minutes", { n: g.dailyMinutes }) : "—"],
              [tr("Why"), REASONS.find(([k]) => k === g.examReason)?.[1] ?? "—"],
            ] as const
          ).map(([l, v]) => (
            <div key={l}>
              <p className="text-xs text-muted">{l}</p>
              <p className="text-ink">{v}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <select {...f("examPreference")} className={`${input} cursor-pointer`}>
              <option value="">{tr("Exam")}</option>
              {EXAMS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select {...f("goalLevel")} className={`${input} cursor-pointer`}>
              <option value="">{tr("Goal level")}</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l === "unsure" ? tr("Not sure yet") : l}
                </option>
              ))}
            </select>
            <input {...f("scoreTarget")} placeholder={tr("Target score, e.g. 65")} className={input} />
            <input type="date" {...f("examDate")} className={input} />
            <input type="number" min={5} max={240} {...f("dailyMinutes")} placeholder={tr("Minutes a day")} className={input} />
            <select {...f("examReason")} className={`${input} cursor-pointer`}>
              <option value="">{tr("Why are you preparing?")}</option>
              {REASONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await saveMyGoals({
                    examPreference: d.examPreference || undefined,
                    goalLevel: d.goalLevel || undefined,
                    scoreTarget: d.scoreTarget || undefined,
                    examDate: d.examDate || null,
                    dailyMinutes: d.dailyMinutes ? Number(d.dailyMinutes) : undefined,
                    examReason: d.examReason || undefined,
                  });
                  setEditing(false);
                  onSaved();
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? tr("Saving…") : tr("Save goals")}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {tr("Cancel")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
