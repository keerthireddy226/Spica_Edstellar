import { useEffect, useState } from "react";
import { Award, BookOpen, CalendarDays, Clock, Flame, Headphones, History, Mic, PenLine, Sparkles, Target, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/api";

interface ProgressData {
  totals: { sessions: number; questions: number; minutes: number; streak: number; xp: number; accuracy: number | null };
  skills: { skill: string; minutes: number; accuracy: number | null; answered: number }[];
  days: { day: string; sessions: number; attempts: number; minutes: number }[];
  recent: { id: string; type: string; mode: string | null; completedAt: string; minutes: number | null; answered: number }[];
  achievements: { id: string; title: string; description: string; icon: string | null; unlockedAt: string | null }[];
  placements: { level: string; percent: number; status: string; takenAt: string }[];
}

const SKILL: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  listening: { icon: Headphones, color: "var(--color-listening)", label: "Listening" },
  speaking: { icon: Mic, color: "var(--color-speaking)", label: "Speaking" },
  reading: { icon: BookOpen, color: "var(--color-reading)", label: "Reading" },
  writing: { icon: PenLine, color: "var(--color-writing)", label: "Writing" },
};
const TYPE: Record<string, string> = { practice: "Practice", mocktest: "Mock test", placement: "Placement test", coach: "Tutor", diagnostic: "Diagnostic", drill: "Drill" };

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
        <p className="relative text-xs font-semibold uppercase tracking-[.18em] text-white/75 mb-3">All time</p>
        <div className="relative grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {(
            [
              ["Sessions", t.sessions, Target],
              ["Questions answered", t.questions, Sparkles],
              ["Minutes practised", t.minutes, Clock],
              ["Accuracy", t.accuracy != null ? `${t.accuracy}%` : "—", Award],
              ["Day streak", t.streak, Flame],
              ["XP earned", t.xp, Trophy],
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
        <Card title="Your skills" icon={Target} color="var(--color-navy)">
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
                      {s?.accuracy != null ? `${s.accuracy}% accurate · ${s.answered} answer${s.answered === 1 ? "" : "s"}` : "Not practised yet"}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-rule overflow-hidden mt-1.5">
                    <div className="h-full rounded-full transition-all" style={{ width: `${s?.accuracy ?? 0}%`, background: meta.color }} />
                  </div>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted">Accuracy across every question you've answered in each skill.</p>
        </Card>
  );
  if (part === "skills") return skills;

  return (
    <>
      {part === "all" && banner}
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {skills}

        <Card title="Last 12 weeks" icon={CalendarDays} color="var(--color-accent)">
          <div className="flex gap-1.5 overflow-x-auto">
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                {w.map((day) => {
                  const v = day.minutes || day.attempts;
                  const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / maxMin) * 4));
                  return (
                    <span
                      key={day.day}
                      title={`${new Date(day.day).toDateString()}: ${day.sessions} session${day.sessions === 1 ? "" : "s"}, ${day.minutes} min`}
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
              Practised on <span className="font-semibold text-ink">{activeDays}</span> of the last 84 days
            </span>
            <span className="flex items-center gap-1">
              Less
              {[0, 1, 2, 3, 4].map((l) => (
                <span key={l} className="h-3 w-3 rounded-[3px]" style={{ background: l === 0 ? "var(--color-rule)" : `color-mix(in srgb, var(--color-accent) ${25 + l * 18}%, var(--color-surface))` }} />
              ))}
              More
            </span>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card title="Recent sessions" icon={History} color="#c9965c">
          {d.recent.length === 0 ? (
            <p className="text-sm text-muted">Finish a practice session and it shows up here.</p>
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
                    {r.answered} answered{r.minutes ? ` · ${r.minutes} min` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Placement history" icon={Award} color="#b97a62">
            {d.placements.length === 0 ? (
              <p className="text-sm text-muted">Take the placement test to see your level here.</p>
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

          <Card title={`Badges · ${unlocked.length} of ${d.achievements.length}`} icon={Trophy} color="var(--color-warning)">
            {d.achievements.length === 0 ? (
              <p className="text-sm text-muted">Badges appear as you practise.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {d.achievements.map((a) => (
                  <div
                    key={a.id}
                    title={a.description}
                    className={`rounded-input px-3 py-2.5 border text-center ${a.unlockedAt ? "border-warning/40 bg-warning/10" : "border-rule opacity-50"}`}
                  >
                    <p className="text-xl">{a.icon ?? "🏅"}</p>
                    <p className="text-xs font-semibold text-ink truncate">{a.title}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
