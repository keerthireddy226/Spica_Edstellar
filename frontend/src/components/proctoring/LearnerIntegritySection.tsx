import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { getLearnerIntegrity, type LearnerIntegrityRow } from "@/api/proctoring";
import { reasonText } from "@/components/proctoring/integrityText";
import { dateTime } from "@/api/staff";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/hooks/useAuth";
import { tr } from "@/i18n/tr";

const STATUS: Record<string, { label: () => string; tone: string }> = {
  in_progress: { label: () => tr("In progress"), tone: "bg-paper-warm text-muted" },
  clear: { label: () => tr("No issues"), tone: "bg-success/15 text-success" },
  flagged: { label: () => tr("Needs review"), tone: "bg-warning/20 text-ink" },
  cleared: { label: () => tr("Cleared"), tone: "bg-success/15 text-success" },
  violation: { label: () => tr("Violation confirmed"), tone: "bg-error/15 text-error" },
};

const REVIEW_PAGE: Record<string, string> = {
  org_admin: ROUTES.ORG_ADMIN_INTEGRITY,
  recruiter: ROUTES.RECRUITER_INTEGRITY,
  admin: ROUTES.ADMIN_CONSOLE_INTEGRITY,
  super_admin: ROUTES.SUPER_INTEGRITY,
};

// A learner's proctored tests on their profile: each one's Attempt ID, risk,
// reasons and decision, linking to the full review. Hidden from anyone who
// can't review this learner (a Manager, for example).
export function LearnerIntegritySection({ learnerId, Section }: { learnerId: string; Section: (p: { title: string; children: React.ReactNode }) => React.ReactNode }) {
  const role = useAuth().user?.role;
  const navigate = useNavigate();
  const [rows, setRows] = useState<LearnerIntegrityRow[] | null>(null);
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    getLearnerIntegrity(learnerId)
      .then((r) => setRows(r.sessions))
      .catch(() => setAllowed(false));
  }, [learnerId]);
  const reviewPage = role ? REVIEW_PAGE[role] : undefined;
  if (!allowed || !reviewPage || rows === null) return null;

  const needsReview = rows.filter((r) => r.status === "flagged").length;
  const violations = rows.filter((r) => r.status === "violation").length;
  return (
    <Section title={tr("Test integrity")}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{tr("No proctored tests yet.")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            {tr("{{n}} proctored tests · {{r}} waiting for review · {{v}} violations confirmed", { n: rows.length, r: needsReview, v: violations })}
          </p>
          <div className="flex flex-col divide-y divide-rule">
            {rows.map((r) => {
              const st = STATUS[r.status] ?? STATUS.in_progress;
              const top = [...r.reasons].sort((a, b) => b.points - a.points).slice(0, 3);
              return (
                <button
                  key={r.session_id}
                  onClick={() => navigate(`${reviewPage}?session=${r.session_id}`)}
                  className="text-left py-2.5 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 hover:bg-paper-warm/60 rounded-input px-2 -mx-2 cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">
                      {r.exam_name ?? (r.session_type === "placement" ? tr("Level test") : tr("Mock exam"))}
                      <span className="font-mono font-normal text-xs text-muted"> · {r.test_code ?? "—"}</span>
                    </p>
                    <p className="text-xs text-muted truncate">
                      {dateTime(r.started_at)}
                      {top.length > 0 && ` · ${top.map((x) => reasonText(x.code, x.count)).join(" · ")}`}
                    </p>
                    {r.reviewed_at && (
                      <p className="text-xs text-muted truncate">
                        {tr("Decided by {{who}} on {{when}}", { who: r.reviewer?.trim() || tr("a reviewer"), when: dateTime(r.reviewed_at) })}
                        {r.review_note ? `: “${r.review_note}”` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.status !== "in_progress" && r.risk_score > 0 && (
                      <span className="text-xs font-semibold text-muted">
                        {tr("Risk {{n}}", { n: r.risk_score })}
                      </span>
                    )}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${st.tone}`}>{st.label()}</span>
                    <ShieldAlert size={14} className="text-muted" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}
