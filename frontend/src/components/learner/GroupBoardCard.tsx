import { useEffect, useState } from "react";
import { Users } from "lucide-react";
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

  // The top 5, plus the learner's own row when they're below it.
  const rows = [...(b.top ?? [])];
  const meShown = rows.some((r) => r.me);

  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-bold text-base text-ink flex items-center gap-2">
          <Users size={17} className="text-accent" /> {tr("Your group this week")}
          <span className="text-xs font-normal text-muted">· {b.group}</span>
        </h2>
        <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
          <input type="checkbox" checked={!!b.hidden} onChange={toggleHidden} />
          {tr("Hide my name")}
        </label>
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
        <table className="w-full text-sm">
          <caption className="text-left text-xs text-muted pb-2">
            <span className="font-semibold text-ink">{tr("Your position: {{rank}} of {{size}}", { rank: b.rank, size: b.size })}</span>
            {" · "}
            {b.topHalf
              ? tr("You're in the top {{p}}% of your group 🔥", { p: b.topPercent })
              : b.climbed && b.climbed > 0
                ? tr("You climbed {{n}} places since last week. {{m}} more points puts you in the top half.", { n: b.climbed, m: b.pointsToTopHalf })
                : tr("{{n}} more points puts you in the top half (about {{s}} sets).", {
                    n: b.pointsToTopHalf,
                    s: Math.max(1, Math.ceil((b.pointsToTopHalf ?? 0) / POINTS_PER_SET)),
                  })}
          </caption>
          <thead>
            <tr className="text-left text-xs text-muted border-b border-rule">
              <th className="py-2 pr-3 pl-2 w-20 font-semibold">{tr("Position")}</th>
              <th className="py-2 pr-3 font-semibold">{tr("Learner")}</th>
              <th className="py-2 pr-3 w-24 font-semibold">{tr("Level")}</th>
              <th className="py-2 pr-2 w-24 text-right font-semibold">{tr("Points")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <BoardRow key={i} rank={row.rank} name={row.me ? tr("You") : (row.name ?? tr("A learner"))} points={row.points} me={row.me} level={row.me ? b.myLevel : null} />
            ))}
            {!meShown && b.rank ? (
              <>
                {/* Positions between the top 5 and yours. */}
                {b.rank > rows.length + 1 && (
                  <tr aria-hidden="true">
                    <td colSpan={4} className="py-1 text-center text-muted">
                      ⋯
                    </td>
                  </tr>
                )}
                <BoardRow rank={b.rank} name={tr("You")} points={b.points?.points ?? 0} me level={b.myLevel} />
              </>
            ) : null}
          </tbody>
        </table>
      )}

      <p className="text-[11px] text-muted">{tr("Points: 10 a set, 2 a right answer, 25 a test, 5 a day you practise. A new week starts every Monday.")}</p>
    </section>
  );
}

function BoardRow({ rank, name, points, me, level }: { rank: number; name: string; points: number; me: boolean; level?: string | null }) {
  return (
    <tr className={`border-b border-rule last:border-0 ${me ? "bg-accent/10 font-semibold" : ""}`}>
      <td className="py-2 pr-3 pl-2 font-display font-bold text-ink">{rank}</td>
      <td className="py-2 pr-3 text-ink">{name}</td>
      <td className="py-2 pr-3 text-ink">{me && level ? level : <span className="text-muted">—</span>}</td>
      <td className="py-2 pr-2 text-right text-ink">{points}</td>
    </tr>
  );
}
