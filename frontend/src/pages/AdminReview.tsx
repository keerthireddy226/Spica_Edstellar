import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ShieldAlert, Check, X, Clock, CheckCircle2, ShieldX, Timer } from "lucide-react";
import { EmptyNote, FilterPills, Notice, PageHeader, StatCard, StatusPill } from "@/components/staff/StaffKit";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { shortDate } from "@/api/staff";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { getPendingReviewPlacements, getReviewHistory, reviewPlacement, type PendingPlacement } from "@/api/adminReview";
import { ROUTES } from "@/constants/routes";

import { tr } from "@/i18n/tr";
const ADMIN_ROLES = ["admin", "super_admin"];

export function AdminReview() {
  const { user } = useAuth();
  const [placements, setPlacements] = useState<PendingPlacement[] | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<Awaited<ReturnType<typeof getReviewHistory>> | null>(null);
  const [verdict, setVerdict] = useState<"all" | "certified" | "fraud_confirmed">("all");
  // "Not them" marks a result as fraud, so it is confirmed first.
  const [confirmingFraud, setConfirmingFraud] = useState<PendingPlacement | null>(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    getReviewHistory()
      .then(setHist)
      .catch(() => {});
    getPendingReviewPlacements()
      .then((res) => setPlacements(res.placements))
      .catch(() => setError(tr("Could not load pending reviews.")));
  }

  async function handleVerdict(id: string, verdict: "certified" | "fraud_confirmed") {
    setActingOn(id);
    setError(null);
    try {
      await reviewPlacement(id, verdict);
      setPlacements((prev) => prev?.filter((p) => p.id !== id) ?? null);
      getReviewHistory()
        .then(setHist)
        .catch(() => {});
    } catch {
      setError(tr("Something went wrong recording that verdict."));
    } finally {
      setActingOn(null);
    }
  }

  if (!user || !ADMIN_ROLES.includes(user.role)) return <Navigate to={ROUTES.DASHBOARD} replace />;

  return (
    <div className="flex flex-col gap-5 w-full">
      <PageHeader
        title={tr("Placement reviews")}
        subtitle={tr("Placements flagged during a face check — not blocked for the learner, just awaiting a verdict here.")}
      />

      {hist && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard variant="split" palette="rose" index={0} icon={Clock} value={hist.stats.pending} label={tr("Waiting for a verdict")} />
          <StatCard variant="split" palette="rose" index={1} icon={CheckCircle2} value={hist.stats.decidedThisMonth} label={tr("Decided this month")} sub={tr("{{cleared}} cleared in total", { cleared: hist.stats.cleared })} />
          <StatCard variant="split" palette="rose" index={2} icon={ShieldX} value={hist.stats.fraud} label={tr("Confirmed not the learner")} sub={hist.stats.cleared + hist.stats.fraud ? tr("{{round}}% of decisions", { round: Math.round((hist.stats.fraud / (hist.stats.cleared + hist.stats.fraud)) * 100) }) : undefined} />
          <StatCard variant="split" palette="rose" index={3} icon={Timer} value={`${hist.stats.avgHoursToDecide} h`} label={tr("Average time to decide")} sub={tr("{{placements}} placement tests taken", { placements: hist.stats.placements })} />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Waiting for review")}</h2>
          {error && (
            <Notice tone="error" onClose={() => setError(null)}>
              {error}
            </Notice>
          )}

          {placements === null && !error && <div className="h-40 rounded-card bg-surface border border-rule animate-pulse" aria-busy="true" />}

          {placements?.length === 0 && <EmptyNote>{tr("Nothing pending review right now.")}</EmptyNote>}

          {placements?.map((p) => (
            <div key={p.id} className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{p.name?.trim() || p.email}</p>
                  <p className="text-xs text-muted">
                    {p.email}
                    {p.org_name ? ` · ${p.org_name}` : tr(" · Individual learner")}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {new Date(p.taken_at).toLocaleString()} &middot; {p.cefr_level} &middot; {p.overall_percent}%
                    {p.test_code && <> &middot; {p.test_code}</>}
                  </p>
                </div>
                <span className="flex items-center gap-1.5 text-xs font-medium text-warning bg-warning/15 rounded-pill px-3 py-1 shrink-0">
                  <ShieldAlert size={14} /> {p.flagged_checks.length === 1 ? tr("1 flagged check") : tr("{{n}} flagged checks", { n: p.flagged_checks.length })}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {p.flagged_checks.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs bg-paper-warm rounded-input px-3 py-2">
                    <span className="font-mono uppercase text-error font-semibold">{c.decision}</span>
                    {c.similarityScore !== null && <span className="text-muted">{tr("similarity {{toFixed}}", { toFixed: Number(c.similarityScore).toFixed(2) })}</span>}
                    <span className="text-muted">{new Date(c.createdAt).toLocaleTimeString()}</span>
                    {c.sampleUri && (
                      <a href={c.sampleUri} target="_blank" rel="noreferrer" className="text-navy-deep font-semibold hover:underline ml-auto">
                        {tr("view photo")}
                      </a>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => handleVerdict(p.id, "certified")} disabled={actingOn === p.id} className="flex-1 flex items-center justify-center gap-1.5">
                  <Check size={15} /> {tr("Confirm, it's them")}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmingFraud(p)} disabled={actingOn === p.id} className="flex-1 flex items-center justify-center gap-1.5 !text-error hover:!border-error/50">
                  <X size={15} /> {tr("Not them")}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3 text-sm">
          <h2 className="font-display font-bold text-lg text-ink">{tr("How flagging works")}</h2>
          <p className="text-muted">{tr("During the placement test Spica checks, a few times, that the person on camera matches the face the learner enrolled.")}</p>
          <p className="text-muted">{tr("When a check doesn't match, the test isn't stopped. The result is held here as \"pending review\" until someone decides.")}</p>
          <ul className="list-disc pl-5 text-muted flex flex-col gap-1">
            <li><span className="text-ink font-medium">{tr("Confirm, it's them")}</span> {tr("— the result is certified and counts.")}</li>
            <li><span className="text-ink font-medium">{tr("Not them")}</span> {tr("— the result is marked as fraud and won't count or appear on certificates.")}</li>
          </ul>
          <p className="text-xs text-muted">{tr("Open each flagged photo before deciding. Every verdict is recorded with your name.")}</p>
        </div>
      </div>

      {hist && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-display font-bold text-lg text-ink">{tr("Past decisions")}</h2>
            <FilterPills
              value={verdict}
              onChange={setVerdict}
              options={[
                ["all", tr("All"), hist.history.length],
                ["certified", tr("Cleared"), hist.history.filter((h) => h.status === "certified").length],
                ["fraud_confirmed", tr("Not the learner"), hist.history.filter((h) => h.status === "fraud_confirmed").length],
              ]}
            />
          </div>
          {hist.history.length === 0 ? (
            <EmptyNote>{tr("No decisions yet.")}</EmptyNote>
          ) : hist.history.every((h) => verdict !== "all" && h.status !== verdict) ? (
            <EmptyNote>{tr("No decisions match.")}</EmptyNote>
          ) : (
            <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-3">{tr("Learner")}</th>
                    <th className="px-4 py-3">{tr("Result")}</th>
                    <th className="px-4 py-3">{tr("Verdict")}</th>
                    <th className="px-4 py-3">{tr("Decided by")}</th>
                    <th className="px-4 py-3">{tr("When")}</th>
                  </tr>
                </thead>
                <tbody>
                  {hist.history
                    .filter((h) => verdict === "all" || h.status === verdict)
                    .map((h) => (
                      <tr key={h.id} className="border-b border-rule last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-ink font-medium">{h.name?.trim() || h.email}</p>
                          <p className="text-xs text-muted">{h.org_name ?? tr("Individual learner")}</p>
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {h.cefr_level} · {h.overall_percent}%
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill tone={h.status === "certified" ? "success" : "error"}>{h.status === "certified" ? tr("Cleared") : tr("Not the learner")}</StatusPill>
                          {h.review_note && <p className="text-xs text-muted mt-1">{h.review_note}</p>}
                        </td>
                        <td className="px-4 py-3 text-muted">{h.reviewer?.trim() || "—"}</td>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">{shortDate(h.reviewed_at)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmingFraud && (
        <ConfirmActionModal
          title={tr("Not them")}
          message={tr("Mark {{name}}'s placement result as not the learner? It won't count or appear on certificates.", { name: confirmingFraud.name?.trim() || confirmingFraud.email })}
          confirmLabel={tr("Not them")}
          destructive
          submitting={actingOn === confirmingFraud.id}
          onClose={() => setConfirmingFraud(null)}
          onConfirm={() => {
            const p = confirmingFraud;
            setConfirmingFraud(null);
            handleVerdict(p.id, "fraud_confirmed");
          }}
        />
      )}
    </div>
  );
}
