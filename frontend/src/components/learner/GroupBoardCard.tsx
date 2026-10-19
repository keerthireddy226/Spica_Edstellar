import { useEffect, useState } from "react";
import { Trophy, TrendingUp, Users } from "lucide-react";
import { getGroupBoard, setBoardNameHidden, type GroupBoard } from "@/api/me";
import { tr } from "@/i18n/tr";

// About this many points a set (10 for the set, a few right answers).
const POINTS_PER_SET = 18;

// "Your group this week": the learner's percentile in their batch on this
// week's progress points, a top 5, and how to move up. Only when their
// organization turned the board on for the batch.
export function GroupBoardCard() {
  const [b, setB] = useState<GroupBoard | null>(null);
  useEffect(() => {
    getGroupBoard()
      .then(setB)
      .catch(() => setB(null));
  }, []);
  if (!b?.enabled) return null;

  const toggleHidden = async () => {
    const next = !b.hidden;
    setB({ ...b, hidden: next });
    await setBoardNameHidden(next).catch(() => setB({ ...b }));
  };

  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-bold text-base text-ink flex items-center gap-2">
          <Users size={17} className="text-accent" /> {tr("Your group this week")}
        </h2>
        <span className="text-xs text-muted">{b.group}</span>
      </div>

      {b.quiet ? (
        <p className="text-sm text-muted">
          {tr("The group board starts once {{n}} people in {{group}} practise this week ({{active}} so far). Every set you do counts.", {
            n: b.needed,
            group: b.group,
            active: b.active,
          })}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${b.topHalf ? "bg-warning/15 text-warning" : "bg-navy/10 text-navy-deep"}`}>
              {b.topHalf ? <Trophy size={22} /> : <TrendingUp size={22} />}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">
                {b.topHalf
                  ? tr("You're in the top {{p}}% of your group 🔥", { p: b.topPercent })
                  : b.climbed && b.climbed > 0
                    ? tr("You climbed {{n}} places since last week", { n: b.climbed })
                    : tr("{{n}} more points puts you in the top half", { n: b.pointsToTopHalf })}
              </p>
              <p className="text-xs text-muted">
                {tr("{{points}} points this week", { points: b.points?.points ?? 0 })}
                {!b.topHalf && b.pointsToTopHalf
                  ? ` · ${
                      b.climbed && b.climbed > 0
                        ? tr("{{n}} more to reach the top half (about {{s}} sets)", { n: b.pointsToTopHalf, s: Math.max(1, Math.ceil(b.pointsToTopHalf / POINTS_PER_SET)) })
                        : tr("about {{n}} more sets", { n: Math.max(1, Math.ceil(b.pointsToTopHalf / POINTS_PER_SET)) })
                    }`
                  : ""}
                {b.topHalf ? ` · ${tr("#{{rank}} of {{size}}", { rank: b.rank, size: b.size })}` : ""}
              </p>
            </div>
          </div>
          <ol className="flex flex-col gap-1">
            {(b.top ?? []).map((row, i) => (
              <BoardRow key={i} rank={row.rank} name={row.me ? tr("You") : (row.name ?? tr("A learner"))} points={row.points} me={row.me} level={row.me ? b.myLevel : null} />
            ))}
            {/* Outside the top 5: the learner's own place, below a gap. */}
            {!(b.top ?? []).some((r) => r.me) && b.rank && (
              <>
                <li className="text-center text-xs text-muted leading-none" aria-hidden="true">⋮</li>
                <BoardRow rank={b.rank} name={tr("You")} points={b.points?.points ?? 0} me level={b.myLevel} />
              </>
            )}
          </ol>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>{tr("Points: 10 a set, 2 a right answer, 25 a test, 5 a day you practise. A new week starts every Monday.")}</span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={!!b.hidden} onChange={toggleHidden} />
          {tr("Hide my name")}
        </label>
      </div>
    </section>
  );
}

function BoardRow({ rank, name, points, me, level }: { rank: number; name: string; points: number; me: boolean; level?: string | null }) {
  return (
    <li className={`flex items-center gap-3 rounded-input px-3 py-1.5 text-sm ${me ? "bg-accent/10 border border-accent/30" : "bg-paper-warm/50"}`}>
      <span className="w-6 text-center font-display font-bold text-ink">{rank}</span>
      <span className={`flex-1 truncate ${me ? "font-semibold text-ink" : "text-ink"}`}>{name}</span>
      {me && level && <span className="text-[11px] font-bold px-2 py-0.5 rounded-pill bg-navy/10 text-navy-deep">{tr("Level {{level}}", { level })}</span>}
      <span className="text-xs text-muted w-14 text-right">{tr("{{n}} pts", { n: points })}</span>
    </li>
  );
}
