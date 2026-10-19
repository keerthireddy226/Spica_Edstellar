import { useEffect, useState } from "react";
import { Award, BookOpen, CalendarDays, ClipboardCheck, Clock, Flame, Headphones, History, Layers, ListChecks, Lock, Mic, PenLine, Sparkles, Star, Target, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/api";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
interface ProgressData {
  totals: { sessions: number; questions: number; minutes: number; streak: number; xp: number; accuracy: number | null };
  skills: { skill: string; minutes: number; accuracy: number | null; answered: number }[];
  days: { day: string; sessions: number; attempts: number; minutes: number }[];
  recent: { id: string; type: string; mode: string | null; completedAt: string; minutes: number | null; answered: number }[];
  achievements: { id: string; title: string; description: string; icon: string | null; unlockedAt: string | null }[];
  placements: { level: string; percent: number; status: string; takenAt: string }[];
}

const SKILL: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  listening: { icon: Headphones, color: "var(--color-listening)", label: tr("Listening") },
  speaking: { icon: Mic, color: "var(--color-speaking)", label: tr("Speaking") },
  reading: { icon: BookOpen, color: "var(--color-reading)", label: tr("Reading") },
  writing: { icon: PenLine, color: "var(--color-writing)", label: tr("Writing") },
};
// Achievement icons are stored by name in the database.
const BADGE_ICON: Record<string, LucideIcon> = {
  flag: ClipboardCheck,
  target: Target,
  flame: Flame,
  layers: Layers,
  award: Award,
  "list-checks": ListChecks,
  trophy: Trophy,
  star: Star,
};
const BADGE_COLORS = ["#b5653f", "#c9965c", "#6e9660", "#a8613f", "#8a8f4f", "#b97a62"];
const TYPE: Record<string, string> = { practice: tr("Practice"), mocktest: tr("Mock test"), placement: tr("Level test"), coach: tr("Tutor"), diagnostic: tr("Diagnostic"), drill: tr("Drill") };

function Card({ title, icon: Icon, color, children }: { title: string; icon: LucideIcon; color: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-4">
      <h2 className="flex items-center gap-2.5 font-display font-bold text-ink">
        <span className="h-9 w-9 rounded-xl flex items-center justify-center text-white" style={{ background: color }}>
          <Icon size={18} />
        </span>
        {title}
      </h2>
      {children}
    </div>
  );
}

// The longer view of a learner's progress: lifetime totals, each skill,
// twelve weeks of practice, recent sessions, placement history and badges.
export function ProgressExtras({ part = "all" }: { part?: "banner" | "details" | "skills" | "all" }) {
  const [d, setD] = useState<ProgressData | null>(null);
  useEffect(() => {
    api<ProgressData>("/me/progress")
      .then(setD)
      .catch(() => {});
  }, []);
  if (!d) return null;
  const t = d.totals;
  const maxMin = Math.max(1, ...d.days.map((x) => x.minutes || x.attempts));
  const weeks: (typeof d.days)[] = [];
  for (let i = 0; i < d.days.length; i += 7) weeks.push(d.days.slice(i, i + 7));
  const activeDays = d.days.filter((x) => x.sessions > 0).length;
  const unlocked = d.achievements.filter((a) => a.unlockedAt);

  const banner = (
      <div
        className="relative overflow-hidden rounded-card shadow-sm px-6 py-5"
        style={{ background: "linear-gradient(120deg, var(--color-navy), color-mix(in srgb, var(--color-navy) 70%, black) 70%, color-mix(in srgb, #c9965c 60%, var(--color-navy)))" }}
      >
        <span className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10" />
        <p className="relative text-xs font-semibold uppercase tracking-[.18em] text-white/75 mb-3">{tr("All time")}</p>
        <div className="relative grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {(
            [
              [tr("Sessions"), t.sessions, Target],
              [tr("Questions answered"), t.questions, Sparkles],
              [tr("Minutes practised"), t.minutes, Clock],
              [tr("Accuracy"), t.accuracy != null ? `${t.accuracy}%` : "—", Award],
              [tr("Day streak"), t.streak, Flame],
              [tr("XP earned"), t.xp, Trophy],
            ] as const
          ).map(([label, value, Icon]) => (
            <div key={label} className="bg-white/12 border border-white/20 rounded-input px-4 py-3 text-white" style={{ background: "rgba(255,255,255,0.12)" }}>
              <Icon size={16} className="text-white/80 mb-1" />
              <p className="font-display font-bold text-2xl">{value}</p>
              <p className="text-xs text-white/80">{label}</p>
            </div>
          ))}
        </div>
      </div>
  );
  if (part === "banner") return banner;

  const skills = (
        <Card title={tr("Your skills")} icon={Target} color="var(--color-navy)">
          {(["listening", "speaking", "reading", "writing"] as const).map((k) => {
            const s = d.skills.find((x) => x.skill === k);
            const meta = SKILL[k];
            return (
              <div key={k} className="flex items-center gap-3">
                <span className="h-10 w-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${meta.color} 18%, var(--color-surface))`, color: meta.color }}>
                  <meta.icon size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-ink">{meta.label}</span>
                    <span className="text-muted">
                      {s?.accuracy != null ? s.answered === 1 ? tr("{{accuracy}}% accurate · 1 answer", { accuracy: s.accuracy }) : tr("{{accuracy}}% accurate · {{n}} answers", { accuracy: s.accuracy, n: s.answered }) : tr("Not practised yet")}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-rule overflow-hidden mt-1.5">
                    <div className="h-full rounded-full transition-all" style={{ width: `${s?.accuracy ?? 0}%`, background: meta.color }} />
                  </div>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted">{tr("Accuracy across every question you've answered in each skill.")}</p>
        </Card>
  );
  if (part === "skills") return skills;

  return (
    <>
      {part === "all" && banner}
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {skills}

        <Card title={tr("Last 12 weeks")} icon={CalendarDays} color="var(--color-accent)">
          <div className="flex gap-1.5 overflow-x-auto">
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                {w.map((day) => {
                  const v = day.minutes || day.attempts;
                  const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / maxMin) * 4));
                  return (
                    <span
                      key={day.day}
                      title={`${new Date(day.day).toLocaleDateString()}: ${day.sessions === 1 ? tr("1 session, {{m}} min", { m: day.minutes }) : tr("{{n}} sessions, {{m}} min", { n: day.sessions, m: day.minutes })}`}
                      className="h-4 w-4 rounded-[4px]"
                      style={{ background: level === 0 ? "var(--color-rule)" : `color-mix(in srgb, var(--color-accent) ${25 + level * 18}%, var(--color-surface))` }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-muted flex-wrap gap-2">
            <span>
              {tr("Practised on")}{" "}<span className="font-semibold text-ink">{activeDays}</span> {tr("of the last 84 days")}</span>
            <span className="flex items-center gap-1">
              {tr("Less")}{[0, 1, 2, 3, 4].map((l) => (
                <span key={l} className="h-3 w-3 rounded-[3px]" style={{ background: l === 0 ? "var(--color-rule)" : `color-mix(in srgb, var(--color-accent) ${25 + l * 18}%, var(--color-surface))` }} />
              ))}
              {tr("More")}</span>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card title={tr("Recent sessions")} icon={History} color="#c9965c">
          {d.recent.length === 0 ? (
            <p className="text-sm text-muted">{tr("Finish a practice session and it shows up here.")}</p>
          ) : (
            <div className="flex flex-col divide-y divide-rule">
              {d.recent.map((r) => (
                <div key={r.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-ink font-medium">{TYPE[r.type] ?? r.type}</p>
                    <p className="text-xs text-muted">
                      {new Date(r.completedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <span className="text-xs text-muted shrink-0">
                    {r.answered > 0 ? `${r.answered} answered` : tr("No answers")}{r.minutes ? tr(" · {{minutes}} min", { minutes: r.minutes }) : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card title={tr("Level test history")} icon={Award} color="#b97a62">
            {d.placements.length === 0 ? (
              <p className="text-sm text-muted">{tr("Take the level test to see your level here.")}</p>
            ) : (
              <div className="flex items-end gap-3 flex-wrap">
                {d.placements.map((p, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <span className="h-12 w-12 rounded-2xl flex items-center justify-center font-display font-bold text-white" style={{ background: "var(--color-navy)" }}>
                      {p.level}
                    </span>
                    <span className="text-[11px] text-muted">{new Date(p.takenAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                    <span className="text-[11px] text-ink">{p.percent}%</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={tr("Badges · {{length}} of {{length2}}", { length: unlocked.length, length2: d.achievements.length })} icon={Trophy} color="var(--color-warning)">
            {d.achievements.length === 0 ? (
              <p className="text-sm text-muted">{tr("Badges appear as you practise.")}</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {d.achievements.map((a, i) => {
                  const Icon = BADGE_ICON[a.icon ?? ""] ?? Award;
                  const color = BADGE_COLORS[i % BADGE_COLORS.length];
                  const earned = !!a.unlockedAt;
                  return (
                    <div
                      key={a.id}
                      title={trServer(a.description)}
                      className={`relative flex flex-col items-center text-center gap-2 rounded-card px-3 pt-4 pb-3 border ${
                        earned ? "shadow-sm" : "bg-paper/50 border-dashed border-rule-strong"
                      }`}
                      style={earned ? { background: `color-mix(in srgb, ${color} 9%, var(--color-surface))`, borderColor: `color-mix(in srgb, ${color} 30%, transparent)` } : undefined}
                    >
                      <span
                        className={`relative h-14 w-14 rounded-full flex items-center justify-center ${earned ? "text-white shadow-md" : "text-muted bg-surface border-2 border-rule"}`}
                        style={
                          earned
                            ? { background: `linear-gradient(145deg, color-mix(in srgb, ${color} 80%, white), ${color} 45%, color-mix(in srgb, ${color} 60%, black))`, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 18%, transparent)` }
                            : undefined
                        }
                      >
                        <Icon size={24} strokeWidth={1.8} />
                        {!earned && (
                          <span className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-surface border border-rule flex items-center justify-center">
                            <Lock size={12} className="text-muted" />
                          </span>
                        )}
                      </span>
                      <p className={`text-sm font-semibold leading-tight ${earned ? "text-ink" : "text-muted"}`}>{trServer(a.title)}</p>
                      <p className="text-[11px] text-muted leading-snug line-clamp-2">
                        {earned
                          ? `Earned ${new Date(a.unlockedAt!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
                          : trServer(a.description)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
