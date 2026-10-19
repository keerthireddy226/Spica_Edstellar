import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { ModalSection } from "@/components/DetailModal";
import { getBatchBoard, setBatchBoardEnabled, type BatchBoard } from "@/api/me";
import { formatShortDate } from "@/api/licenses";
import { tr } from "@/i18n/tr";

// A batch's group leaderboard this week for its admin (who can turn the
// learners' view on or off) and managers: everyone with points, level and
// when they last practised.
export function BatchLeaderboardSection({ batchId, scope }: { batchId: string; scope: "org-admin" | "manager" }) {
  const [board, setBoard] = useState<BatchBoard | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    getBatchBoard(scope, batchId)
      .then(setBoard)
      .catch(() => setBoard(null));
  }, [batchId, scope]);
  if (!board) return null;

  async function toggle() {
    if (!board) return;
    setSaving(true);
    try {
      const r = await setBatchBoardEnabled(batchId, !board.enabled);
      setBoard({ ...board, enabled: r.enabled });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalSection
      title={tr("Leaderboard this week")}
      icon={Trophy}
      action={
        scope === "org-admin" ? (
          <label className="flex items-center gap-1.5 text-xs text-ink cursor-pointer">
            <input type="checkbox" checked={board.enabled} disabled={saving} onChange={toggle} />
            {tr("Show learners their group board")}
          </label>
        ) : (
          <span className="text-xs text-muted">{board.enabled ? tr("Learners see it") : tr("Hidden from learners")}</span>
        )
      }
    >
      <p className="text-xs text-muted mb-2">
        {tr("Points since {{date}}: 10 a set, 2 a right answer, 25 a test, 5 a day practised. Learners see their position and the top 5 by Learner ID, never names, levels or scores of others.", {
          date: formatShortDate(board.weekStart),
        })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">{tr("Learner")}</th>
              <th className="py-1 pr-2">{tr("Learner ID")}</th>
              <th className="py-1 pr-2 text-right">{tr("Points")}</th>
              <th className="py-1 pr-2 text-right">{tr("Sets")}</th>
              <th className="py-1 pr-2 text-right">{tr("Tests")}</th>
              <th className="py-1 pr-2">{tr("Level")}</th>
              <th className="py-1">{tr("Last active")}</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r) => (
              <tr key={r.id} className="border-t border-rule">
                <td className="py-1.5 pr-2 font-semibold">{r.points > 0 ? r.rank : "–"}</td>
                <td className="py-1.5 pr-2">{r.name}</td>
                <td className="py-1.5 pr-2 font-mono text-xs text-muted">{r.learnerId ?? "—"}</td>
                <td className="py-1.5 pr-2 text-right font-semibold">{r.points}</td>
                <td className="py-1.5 pr-2 text-right">{r.sets}</td>
                <td className="py-1.5 pr-2 text-right">{r.tests}</td>
                <td className="py-1.5 pr-2">{r.level ?? "—"}</td>
                <td className="py-1.5 text-xs text-muted">{r.lastActive ? formatShortDate(r.lastActive) : tr("Never")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ModalSection>
  );
}
