import { useEffect, useState } from "react";
import { Badge, DetailModal } from "@/components/DetailModal";
import { BatchLeaderboardSection } from "@/components/BatchLeaderboardSection";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import { BatchFixedLicenses } from "@/components/licenses/BatchFixedLicenses";
import { BatchFormModal } from "@/components/BatchFormModal";
import { BatchDetailsGrid } from "@/components/BatchDetailsGrid";
import { BatchLifecycleActions, BATCH_STATUS_LABEL } from "@/components/BatchLifecycleActions";
import { LicenseStatusPill } from "@/components/licenses/LicenseStatusPill";
import { Award, Layers, Pencil } from "lucide-react";
import { orgCertificates, revokeCertificate, type CertificateSummary } from "@/api/reports";
import { getBatchDetail, getOrgLearnerDetail, updateBatch, updateOrgLearnerDetails, type OrgBatchDetail, type OrgBatchLearner } from "@/api/orgAdmin";

import { tr } from "@/i18n/tr";
function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Reachable by clicking any batch card on the Org Admin's Batches page —
// shows the batch's own details plus every learner in it, each opening the
// same LearnerProfileModal used everywhere else in the console.
export function OrgAdminBatchDetailModal({ batchId, onClose, onChanged }: { batchId: string; onClose: () => void; onChanged?: () => void }) {
  const [batch, setBatch] = useState<OrgBatchDetail | null>(null);
  const [learners, setLearners] = useState<OrgBatchLearner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingLearnerId, setViewingLearnerId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [certs, setCerts] = useState<Map<string, CertificateSummary>>(new Map());

  function loadCerts() {
    orgCertificates(batchId)
      .then((r) => setCerts(new Map(r.certificates.filter((c) => !c.revokedAt && c.userId).map((c) => [c.userId!, c]))))
      .catch(() => {});
  }

  function load() {
    loadCerts();
    getBatchDetail(batchId)
      .then((res) => {
        setBatch(res.batch);
        setLearners(res.learners);
      })
      .catch(() => setError(tr("Could not load this batch's details.")));
  }

  useEffect(load, [batchId]);

  if (error) {
    return (
      <DetailModal title={tr("Batch details")} onClose={onClose}>
        <p className="text-sm text-error">{error}</p>
      </DetailModal>
    );
  }
  if (!batch || !learners) {
    return (
      <DetailModal title={tr("Batch details")} onClose={onClose}>
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      </DetailModal>
    );
  }

  return (
    <DetailModal
      title={batch.name}
      subtitle={[
        tr("{{batchCode}} · {{status}} · Created {{date}}", { batchCode: batch.batchCode, status: BATCH_STATUS_LABEL[batch.status], date: formatDate(batch.createdAt) }),
        batch.endDate ? (batch.status === "active" ? tr("Ends {{date}}", { date: formatDate(batch.endDate) }) : tr("Ended {{date}}", { date: formatDate(batch.endDate) })) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      icon={Layers}
      badges={
        <>
          <Badge tone={batch.status === "active" ? "good" : "neutral"}>{BATCH_STATUS_LABEL[batch.status]}</Badge>
          {(batch.startCefr || batch.targetCefr) && <Badge>{`${batch.startCefr ?? "?"} → ${batch.targetCefr ?? "?"}`}</Badge>}
          {batch.managerNames.length > 0 && <Badge>{batch.managerNames.join(", ")}</Badge>}
        </>
      }
      stats={[
        { label: tr("Learners"), value: batch.capacity ? `${learners.filter((l) => l.active).length} / ${batch.capacity}` : learners.filter((l) => l.active).length },
        { label: tr("Licensed now"), value: batch.licenses?.licensed ?? 0, hint: tr("{{v}} without a license", { v: batch.licenses?.unlicensed ?? 0 }) },
        { label: tr("Fixed licenses left"), value: batch.fixedLicenses == null ? "—" : Math.max(0, batch.fixedLicenses - batch.fixedLicensesUsed), hint: batch.fixedLicenses == null ? tr("Uses Managers' pools") : `of ${batch.fixedLicenses}` },
        { label: tr("Sessions completed"), value: learners.reduce((n, l) => n + l.sessionCount, 0) },
      ]}
      onClose={onClose}
      wide
      actions={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {batch.status !== "archived" && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill border border-rule text-sm font-semibold text-ink hover:bg-paper-warm transition-colors cursor-pointer"
            >
              <Pencil size={14} /> {tr("Edit")}</button>
          )}
          <BatchLifecycleActions
            batchId={batch.id}
            batchName={batch.name}
            status={batch.status}
            onChanged={(msg) => {
              setNotice(msg);
              load();
              onChanged?.();
            }}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-2.5">{notice}</p>}
        <BatchDetailsGrid
          batch={batch}
          learnerCount={learners.filter((l) => l.active).length}
          managedBy={batch.managerNames.length === 0 ? tr("No manager assigned yet") : batch.managerNames.join(", ")}
        />

        <BatchFixedLicenses
          batchId={batch.id}
          allotted={batch.fixedLicenses ?? null}
          used={batch.fixedLicensesUsed ?? 0}
          stats={batch.assignments}
          learnersLicensed={learners.filter((l) => l.license && (l.license.status === "active" || l.license.status === "grace")).length}
          learnersTotal={learners.length}
          onChanged={() => {
            load();
            onChanged?.();
          }}
        />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{tr("Learners")}</p>
          {learners.length === 0 ? (
            <p className="text-sm text-muted">{tr("No learners in this batch yet.")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {learners.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setViewingLearnerId(l.id)}
                  className="border border-rule rounded-input px-4 py-3 flex items-center gap-3 text-left hover:border-rule-strong hover:bg-paper-warm transition-colors cursor-pointer"
                >
                  <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                    {initials(l.firstName, l.lastName, l.email)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email}</p>
                    <p className="text-xs text-muted">
                      {[l.employeeId, l.department, l.jobTitle, l.sessionCount === 1 ? tr("1 session completed") : tr("{{n}} sessions completed", { n: l.sessionCount })].filter(Boolean).join(" · ")}</p>
                  </div>
                  {l.license && <LicenseStatusPill license={l.license} />}
                  {certs.get(l.id) ? (
                    <span className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <a
                        href={`/certificate/${certs.get(l.id)!.code}`}
                        target="_blank"
                        rel="noreferrer"
                        title={tr("View certificate")}
                        className="flex items-center gap-1 text-xs font-semibold text-navy hover:underline"
                      >
                        <Award size={14} /> {tr("Certificate")}</a>
                      <span
                        role="button"
                        title={tr("Revoke certificate")}
                        onClick={() => revokeCertificate(certs.get(l.id)!.id).then(loadCerts)}
                        className="text-muted hover:text-error cursor-pointer px-1"
                      >
                        ×
                      </span>
                    </span>
                  ) : null}
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill shrink-0 ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                    {l.active ? tr("Active") : tr("Deactivated")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <BatchFormModal
          title={tr("Edit batch")}
          submitLabel={tr("Save changes")}
          initial={{ ...batch, targetCutScore: batch.targetCutScore != null ? Number(batch.targetCutScore) : null }}
          note={tr("Fixed licenses are changed in the Licenses section of the batch.")}
          onClose={() => setEditing(false)}
          onSubmit={async (d) => {
            await updateBatch(batch.id, d);
            setEditing(false);
            load();
            onChanged?.();
          }}
        />
      )}

      <BatchLeaderboardSection batchId={batchId} scope="org-admin" />

      {viewingLearnerId && (
        <LearnerProfileModal
          learnerId={viewingLearnerId}
          onClose={onClose}
          onBack={() => setViewingLearnerId(null)}
          fetcher={getOrgLearnerDetail}
          saveDetails={(id, d) => updateOrgLearnerDetails(id, d).then(load)}
        />
      )}
    </DetailModal>
  );
}
