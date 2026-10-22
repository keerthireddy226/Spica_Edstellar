import { useEffect, useState } from "react";
import { Award, CheckCircle2, Copy, Layers, Pencil } from "lucide-react";
import { BatchDetailsGrid } from "@/components/BatchDetailsGrid";
import { BatchFormModal } from "@/components/BatchFormModal";
import { Badge, DetailModal } from "@/components/DetailModal";
import { BatchLeaderboardSection } from "@/components/BatchLeaderboardSection";
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
import { certificateByLearner, managerCertificates, managerRevokeCertificate, type CertificateSummary } from "@/api/reports";
import type { CertifiedSummary } from "@/components/CertifiedCell";

import { tr } from "@/i18n/tr";
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
      .catch(() => setMsg({ ok: false, text: tr("Could not load this batch.") }));
    // Earlier course certificates issued in this batch (still revocable). A
    // final assessment's comes with each learner (`certified`), so it follows
    // a learner who moved batches and an expired one doesn't show.
    managerCertificates(batchId)
      .then((r) => setCerts(certificateByLearner(r.certificates.filter((c) => c.kind !== "result"))))
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
      setMsg({ ok: false, text: planErrorMessage(err) ?? tr("That didn't work. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <DetailModal title={tr("Batch")} onClose={onClose}>
        <p className={`text-sm ${msg ? "text-error" : "text-muted"}`}>{msg?.text ?? tr("Loading…")}</p>
      </DetailModal>
    );
  }
  const b = data.batch;

  return (
    <DetailModal
      title={b.name}
      subtitle={[
        b.batchCode,
        BATCH_STATUS_LABEL[b.status],
        b.endDate ? (b.status === "active" ? tr("Ends {{date}}", { date: fmt(b.endDate) }) : tr("Ended {{date}}", { date: fmt(b.endDate) })) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      icon={Layers}
      badges={
        <>
          <Badge tone={b.status === "active" ? "good" : "neutral"}>{BATCH_STATUS_LABEL[b.status]}</Badge>
          {(b.startCefr || b.targetCefr) && <Badge>{`${b.startCefr ?? "?"} → ${b.targetCefr ?? "?"}`}</Badge>}
          {b.department && <Badge>{b.department}</Badge>}
        </>
      }
      stats={[
        { label: tr("Learners"), value: b.capacity ? `${b.licenses.learners} / ${b.capacity}` : b.licenses.learners },
        { label: tr("Licensed now"), value: b.licenses.licensed, hint: tr("{{unlicensed}} without a license", { unlicensed: b.licenses.unlicensed }) },
        { label: tr("Fixed licenses left"), value: b.fixedLicenses == null ? "—" : Math.max(0, b.fixedLicenses - b.fixedLicensesUsed), hint: b.fixedLicenses == null ? tr("Uses your pool") : tr("of {{n}}", { n: b.fixedLicenses }) },
        { label: tr("Ending soon"), value: b.licenses.endingSoon, hint: tr("Access ends within 14 days") },
      ]}
      onClose={onClose}
      wide
      actions={
        <div className="flex gap-2 flex-wrap justify-end">
          {b.status !== "archived" && (
            <button className={pill} disabled={busy} onClick={() => setEditing(true)}>
              <Pencil size={14} /> {tr("Edit")}</button>
          )}
          {b.status === "active" && (
            <button
              className={pill}
              disabled={busy}
              onClick={() =>
                run(
                  () => managerCompleteBatch(b.id),
                  (r) =>
                    [
                      tr("{{name}} is complete.", { name: b.name }),
                      r.certificatesIssued ? (r.certificatesIssued === 1 ? tr("1 certificate issued.") : tr("{{n}} certificates issued.", { n: r.certificatesIssued })) : null,
                      r.releasedLicenses
                        ? r.releasedLicenses === 1
                          ? tr("1 unused fixed license went back to the organization.")
                          : tr("{{n}} unused fixed licenses went back to the organization.", { n: r.releasedLicenses })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" "),
                )
              }
            >
              <CheckCircle2 size={14} /> {tr("Complete")}</button>
          )}
          <button className={pill} disabled={busy} onClick={() => setCloning((c) => !c)}>
            <Copy size={14} /> {tr("Start a new batch from this")}</button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {msg && (
          <p className={`text-sm rounded-input px-3.5 py-2.5 border ${msg.ok ? "text-success bg-success/10 border-success/25" : "text-error bg-error/10 border-error/25"}`}>{msg.text}</p>
        )}
        {cloning && (
          <div className="flex gap-2 items-center flex-wrap bg-surface border border-rule rounded-card shadow-sm p-4">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Copy size={15} className="text-navy" /> {tr("Start a new batch from this")}
            </span>
            <input aria-label={tr("Name")} value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="flex-1 min-w-48 rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            <Button
              type="button"
              disabled={busy || !cloneName.trim()}
              onClick={() => run(() => managerCloneBatch(b.id, { name: cloneName.trim() }), () => tr("{{trim}} created with the same goals and settings.", { trim: cloneName.trim() })).then(() => setCloning(false))}
              className="!px-3.5 !py-2"
            >
              {tr("Create")}</Button>
            <Button type="button" variant="secondary" onClick={() => setCloning(false)} className="!px-3.5 !py-2">
              {tr("Cancel")}
            </Button>
          </div>
        )}

        <BatchDetailsGrid
          batch={b}
          learnerCount={data.learners.filter((l) => l.active).length}
          managedBy={b.managerNames.length > 1 ? b.managerNames.join(", ") : tr("Just you")}
        />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{tr("Licenses")}</p>
          <div className="bg-surface border border-rule rounded-card shadow-sm px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("Fixed licenses")}</p>
              <p className="text-ink">
                {b.fixedLicenses === null ? tr("None — your pool") : tr("{{fixedLicensesUsed}} used of {{fixedLicenses}} · {{max}} left", { fixedLicensesUsed: b.fixedLicensesUsed, fixedLicenses: b.fixedLicenses, max: Math.max(0, b.fixedLicenses - b.fixedLicensesUsed) })}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("From your pool")}</p>
              <p className="text-ink">{b.licenses.fromPool === 1 ? tr("1 license-month") : tr("{{n}} license-months", { n: b.licenses.fromPool })}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("Learners licensed")}</p>
              <p className="text-ink">
                {tr("{{licensed}} of {{learners}}", { licensed: b.licenses.licensed, learners: b.licenses.learners })}
                {b.licenses.endingSoon ? tr(" · {{endingSoon}} ending soon", { endingSoon: b.licenses.endingSoon }) : ""}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("Without a license")}</p>
              <p className={b.licenses.unlicensed ? "text-error" : "text-ink"}>{b.licenses.unlicensed}</p>
            </div>
            {b.status === "active" && poolLeft !== null && poolLeft > 0 && (
              <div className="col-span-2 sm:col-span-4 flex items-center gap-2 flex-wrap pt-3 border-t border-rule">
                <span className="text-xs text-muted">{tr("Set aside licenses from your pool ({{poolLeft}} left) for this batch only:", { poolLeft: poolLeft })}</span>
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
                      () => tr("{{floor}} licenses moved from your pool to {{name}}.", { floor: Math.floor(Number(moveQty)), name: b.name }),
                    ).then(() => setMoveQty(""))
                  }
                >
                  {tr("Move to batch")}</button>
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{tr("Learners ({{length}})", { length: data.learners.length })}</p>
          {data.learners.length === 0 ? (
            <p className="text-sm text-muted bg-surface border border-dashed border-rule-strong rounded-card px-5 py-5">{tr("No learners in this batch yet.")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.learners.map((l) => {
                const certified = (l as { certified?: CertifiedSummary | null }).certified ?? null;
                const cert = certs.get(l.id);
                return (
                  <div
                    key={l.id}
                    onClick={() => setViewing(l.id)}
                    className="bg-surface border border-rule rounded-card shadow-sm px-4 py-3 flex items-center gap-3 hover:border-navy/40 hover:shadow-md transition-all cursor-pointer"
                  >
                    <span className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${l.active ? "bg-navy text-lime" : "bg-rule text-muted"}`}>
                      {(`${l.firstName?.[0] ?? ""}${l.lastName?.[0] ?? ""}`.toUpperCase() || l.email.slice(0, 2).toUpperCase())}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email}</p>
                      <p className="text-xs text-muted truncate">
                        {[l.employeeId, l.department, l.jobTitle, l.sessionCount === 1 ? tr("1 session completed") : tr("{{n}} sessions completed", { n: l.sessionCount })].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {!l.active ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-error/15 text-error whitespace-nowrap">{tr("Deactivated")}</span>
                    ) : !l.hasLoggedIn ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-warning/15 text-navy-deep whitespace-nowrap">{tr("Invite pending")}</span>
                    ) : null}
                    {l.license && <LicenseStatusPill license={l.license} />}
                    <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                      {certified ? (
                        <a href={`/certificate/${certified.code}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-navy hover:underline">
                          <Award size={14} /> {`${certified.level ?? ""}${certified.score != null ? ` · ${certified.score}` : ""}`}
                        </a>
                      ) : cert ? (
                        <span className="flex items-center gap-1">
                          <a href={`/certificate/${cert.code}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-navy hover:underline">
                            <Award size={14} /> {tr("Course certificate")}
                          </a>
                          <button
                            onClick={() => window.confirm(tr("Revoke this certificate?")) && managerRevokeCertificate(cert.id).then(load)}
                            title={tr("Revoke")}
                            className="text-muted hover:text-error px-1 cursor-pointer"
                          >
                            ×
                          </button>
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <BatchLeaderboardSection batchId={batchId} scope="manager" />
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
          title={tr("Edit batch")}
          submitLabel={tr("Save changes")}
          initial={{ ...b, targetCutScore: b.targetCutScore != null ? Number(b.targetCutScore) : null }}
          note={tr("Fixed licenses are set by your Org Admin.")}
          onClose={() => setEditing(false)}
          onSubmit={async (d) => {
            await managerUpdateBatch(b.id, d);
            setEditing(false);
            setMsg({ ok: true, text: tr("Batch updated.") });
            load();
            onChanged();
          }}
        />
      )}
    </DetailModal>
  );
}
