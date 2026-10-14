import { useEffect, useState } from "react";
import { Award, CheckCircle2, Copy, Layers, Pencil } from "lucide-react";
import { BatchDetailsGrid } from "@/components/BatchDetailsGrid";
import { BatchFormModal } from "@/components/BatchFormModal";
import { Badge, DetailModal } from "@/components/DetailModal";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import { LicenseStatusPill } from "@/components/licenses/LicenseStatusPill";
import { Button } from "@/components/Button";
import { BATCH_STATUS_LABEL } from "@/components/BatchLifecycleActions";
import { planErrorMessage } from "@/api/plans";
import { getManagerLicenseOverview } from "@/api/licenses";
import { refreshPlan } from "@/components/plans/usePlan";
import {
  getManagerBatch,
  getManagerLearnerDetail,
  managerCloneBatch,
  managerCompleteBatch,
  managerMovePoolToBatch,
  managerUpdateBatch,
  managerUpdateLearnerDetails,
  type ManagerBatchDetail,
} from "@/api/manager";
import { managerCertificates, managerIssueCertificate, managerRevokeCertificate, type CertificateSummary } from "@/api/reports";

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const pill = "flex items-center gap-1.5 px-3 py-1.5 rounded-pill border border-rule text-sm font-semibold text-ink hover:bg-paper-warm transition-colors cursor-pointer disabled:opacity-50";

// A Manager's own batch: details, licenses, learners, certificates, editing
// it, and closing it out or starting the next one from it.
export function ManagerBatchModal({ batchId, onClose, onChanged }: { batchId: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<ManagerBatchDetail | null>(null);
  const [certs, setCerts] = useState<Map<string, CertificateSummary>>(new Map());
  const [viewing, setViewing] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [poolLeft, setPoolLeft] = useState<number | null>(null);
  const [moveQty, setMoveQty] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function load() {
    getManagerLicenseOverview()
      .then((r) => setPoolLeft(r.myPool?.allotment != null ? (r.myPool.remaining ?? 0) : null))
      .catch(() => {});
    getManagerBatch(batchId)
      .then((d) => {
        setData(d);
        setCloneName(`${d.batch.name} (next)`);
      })
      .catch(() => setMsg({ ok: false, text: "Could not load this batch." }));
    managerCertificates(batchId)
      .then((r) => setCerts(new Map(r.certificates.filter((c) => !c.revokedAt && c.userId).map((c) => [c.userId!, c]))))
      .catch(() => {});
  }
  useEffect(load, [batchId]);

  async function run(fn: () => Promise<unknown>, ok: (r: any) => string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: ok(r) });
      refreshPlan();
      load();
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: planErrorMessage(err) ?? "That didn't work. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <DetailModal title="Batch" onClose={onClose}>
        <p className={`text-sm ${msg ? "text-error" : "text-muted"}`}>{msg?.text ?? "Loading…"}</p>
      </DetailModal>
    );
  }
  const b = data.batch;

  return (
    <DetailModal
      title={b.name}
      subtitle={`${b.batchCode} · ${BATCH_STATUS_LABEL[b.status]}${b.endDate ? ` · ${b.status === "active" ? "ends" : "ended"} ${fmt(b.endDate)}` : ""}`}
      icon={Layers}
      badges={
        <>
          <Badge tone={b.status === "active" ? "good" : "neutral"}>{BATCH_STATUS_LABEL[b.status]}</Badge>
          {(b.startCefr || b.targetCefr) && <Badge>{`${b.startCefr ?? "?"} → ${b.targetCefr ?? "?"}`}</Badge>}
          {b.department && <Badge>{b.department}</Badge>}
        </>
      }
      stats={[
        { label: "Learners", value: b.capacity ? `${b.licenses.learners} / ${b.capacity}` : b.licenses.learners },
        { label: "Licensed now", value: b.licenses.licensed, hint: `${b.licenses.unlicensed} without a license` },
        { label: "Fixed licenses left", value: b.fixedLicenses == null ? "—" : Math.max(0, b.fixedLicenses - b.fixedLicensesUsed), hint: b.fixedLicenses == null ? "Uses your pool" : `of ${b.fixedLicenses}` },
        { label: "Ending soon", value: b.licenses.endingSoon, hint: "Access ends within 14 days" },
      ]}
      onClose={onClose}
      wide
      actions={
        <div className="flex gap-2 flex-wrap justify-end">
          {b.status !== "archived" && (
            <button className={pill} disabled={busy} onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </button>
          )}
          {b.status === "active" && (
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                run(
                  () => managerCompleteBatch(b.id),
                  (r) =>
                    `${b.name} is complete.${r.certificatesIssued ? ` ${r.certificatesIssued} certificate${r.certificatesIssued === 1 ? "" : "s"} issued.` : ""}${
                      r.releasedLicenses ? ` ${r.releasedLicenses} unused fixed licenses went back to the organization.` : ""
                    }`,
                )
              }
            >
              <CheckCircle2 size={14} /> Complete
            </button>
          )}
          <button className={pill} disabled={busy} onClick={() => setCloning((c) => !c)}>
            <Copy size={14} /> Start a new batch from this
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}
        {cloning && (
          <div className="flex gap-2 items-center bg-paper-warm rounded-input p-3">
            <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="flex-1 rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            <Button
              disabled={busy || !cloneName.trim()}
              onClick={() => run(() => managerCloneBatch(b.id, { name: cloneName.trim() }), () => `${cloneName.trim()} created with the same goals and settings.`).then(() => setCloning(false))}
              className="!px-3.5 !py-2"
            >
              Create
            </Button>
          </div>
        )}

        <BatchDetailsGrid
          batch={b}
          learnerCount={data.learners.filter((l) => l.active).length}
          managedBy={b.managerNames.length > 1 ? b.managerNames.join(", ") : "Just you"}
        />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Licenses</p>
          <div className="border border-rule rounded-input px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted">Fixed licenses</p>
              <p className="text-ink">
                {b.fixedLicenses === null ? "None — your pool" : `${b.fixedLicensesUsed} used of ${b.fixedLicenses} · ${Math.max(0, b.fixedLicenses - b.fixedLicensesUsed)} left`}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">From your pool</p>
              <p className="text-ink">{b.licenses.fromPool} license-month{b.licenses.fromPool === 1 ? "" : "s"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Learners licensed</p>
              <p className="text-ink">
                {b.licenses.licensed} of {b.licenses.learners}
                {b.licenses.endingSoon ? ` · ${b.licenses.endingSoon} ending soon` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Without a license</p>
              <p className={b.licenses.unlicensed ? "text-error" : "text-ink"}>{b.licenses.unlicensed}</p>
            </div>
            {b.status === "active" && poolLeft !== null && poolLeft > 0 && (
              <div className="col-span-2 sm:col-span-4 flex items-center gap-2 flex-wrap pt-3 border-t border-rule">
                <span className="text-xs text-muted">Set aside licenses from your pool ({poolLeft} left) for this batch only:</span>
                <input
                  type="number"
                  min={1}
                  max={poolLeft}
                  value={moveQty}
                  onChange={(e) => setMoveQty(e.target.value)}
                  className="w-24 rounded-input border border-rule bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-navy focus:outline-none"
                />
                <button
                  className={pill}
                  disabled={busy || !(Number(moveQty) >= 1 && Number(moveQty) <= poolLeft)}
                  onClick={() =>
                    run(
                      () => managerMovePoolToBatch(b.id, Math.floor(Number(moveQty))),
                      () => `${Math.floor(Number(moveQty))} licenses moved from your pool to ${b.name}.`,
                    ).then(() => setMoveQty(""))
                  }
                >
                  Move to batch
                </button>
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Learners ({data.learners.length})</p>
          {data.learners.length === 0 ? (
            <p className="text-sm text-muted">No learners in this batch yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.learners.map((l) => {
                const cert = certs.get(l.id);
                return (
                  <div
                    key={l.id}
                    onClick={() => setViewing(l.id)}
                    className="border border-rule rounded-input px-4 py-3 flex items-center gap-3 hover:bg-paper-warm transition-colors cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email}</p>
                      <p className="text-xs text-muted">
                        {[l.employeeId, l.department, l.jobTitle].filter(Boolean).map((x) => `${x} · `).join("")}
                        {l.sessionCount} session{l.sessionCount === 1 ? "" : "s"}
                        {!l.hasLoggedIn ? " · invite pending" : ""}
                        {!l.active ? " · deactivated" : ""}
                      </p>
                    </div>
                    {l.license && <LicenseStatusPill license={l.license} />}
                    <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                      {cert ? (
                        <span className="flex items-center gap-1">
                          <a href={`/certificate/${cert.code}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-navy hover:underline">
                            <Award size={14} /> Certificate
                          </a>
                          <button onClick={() => managerRevokeCertificate(cert.id).then(load)} title="Revoke" className="text-muted hover:text-error px-1 cursor-pointer">
                            ×
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => managerIssueCertificate(l.id).then(load)} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
                          Issue certificate
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {viewing && (
        <LearnerProfileModal
          learnerId={viewing}
          onClose={onClose}
          onBack={() => setViewing(null)}
          fetcher={getManagerLearnerDetail}
          saveDetails={(id, d) => managerUpdateLearnerDetails(id, d).then(load)}
        />
      )}
      {editing && (
        <BatchFormModal
          title="Edit batch"
          submitLabel="Save changes"
          initial={{ ...b, targetCutScore: b.targetCutScore != null ? Number(b.targetCutScore) : null }}
          note="Fixed licenses are set by your Org Admin."
          onClose={() => setEditing(false)}
          onSubmit={async (d) => {
            await managerUpdateBatch(b.id, d);
            setEditing(false);
            setMsg({ ok: true, text: "Batch updated." });
            load();
            onChanged();
          }}
        />
      )}
    </DetailModal>
  );
}
