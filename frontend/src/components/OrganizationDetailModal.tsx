import { useCallback, useEffect, useState } from "react";
import { Badge, DetailModal, InfoGrid, ModalEmpty, ModalRow, ModalSection, Pill } from "@/components/DetailModal";
import { Building2, GraduationCap, HeartPulse, Receipt, ShieldCheck, Target, Users } from "lucide-react";
import { OrgAdminDetailModal } from "@/components/OrgAdminDetailModal";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";
import type { AdminConsoleOrg } from "@/api/admin";
import { countryName, employeeCountLabel } from "@/constants/demographics";
import { OrgLicensesPanel } from "@/components/licenses/OrgLicensesPanel";
import { OrgPlanAdminPanel } from "@/components/plans/OrgPlanAdminPanel";
import { OrgAdminRecovery } from "@/components/OrgAdminRecovery";
import { OrgAuditPanel } from "@/components/OrgAuditPanel";
import { OrgCommercialPanel } from "@/components/OrgCommercialPanel";
import { ProctoringSettings } from "@/components/proctoring/ProctoringSettings";
import { OrgProductsPanel } from "@/components/recruitment/OrgProductsPanel";
import { OrgCandidatesPanel } from "@/components/recruitment/OrgCandidatesPanel";
import { getOrgCandidates, type OrgBatch, type OrgCandidate } from "@/api/recruitment";
import { getTenantProctoringPolicy, saveTenantProctoringPolicy, type ProctoringPolicy } from "@/api/proctoring";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
function categoryLabel(category: string | null): string {
  return category === "university" ? tr("University") : tr("Organization");
}

// An organization's own detail view, opened straight from the Admin
// console's Organizations table — data is already loaded there, so no
// fetch here, just the same Org Admin / Manager drill-down used everywhere
// else (shared OrgAdminDetailModal / ManagerDetailModal).
export function OrganizationDetailModal({ org, onClose, onChanged }: { org: AdminConsoleOrg; onClose: () => void; onChanged?: () => void }) {
  const [viewingOrgAdminId, setViewingOrgAdminId] = useState<string | null>(null);
  const [viewingManagerId, setViewingManagerId] = useState<string | null>(null);
  const [planTier, setPlanTier] = useState<string>(org.planTier);
  const [tab, setTab] = useState("overview");
  // People the organization tested (recruitment): loaded with the window, for
  // the count on top and the Candidates tab.
  const recruits = !!org.products?.includes("recruitment");
  const recruitOnly = recruits && !org.products?.includes("skills");
  const [candidates, setCandidates] = useState<OrgCandidate[] | null>(null);
  const [batches, setBatches] = useState<OrgBatch[]>([]);
  useEffect(() => {
    if (!recruits) return;
    getOrgCandidates(org.id)
      .then((r) => {
        setCandidates(r.candidates);
        setBatches(r.batches);
      })
      .catch(() => setCandidates([]));
  }, [recruits, org.id]);
  const managedLearners = org.managers.reduce((n, m) => n + m.learnerCount, 0);
  const tierLabel = planTier.charAt(0).toUpperCase() + planTier.slice(1);
  const loadProctoring = useCallback(() => getTenantProctoringPolicy(org.id), [org.id]);
  const saveProctoring = useCallback((p: ProctoringPolicy) => saveTenantProctoringPolicy(org.id, p), [org.id]);

  return (
    <DetailModal
      title={org.name}
      subtitle={[org.legalName, org.industry, countryName(org.country, "en") !== "—" ? countryName(org.country, "en") : null].filter(Boolean).join(" · ") || categoryLabel(org.category)}
      icon={org.category === "university" ? GraduationCap : Building2}
      badges={
        <>
          <Badge tone={org.active ? "good" : "bad"}>{org.active ? tr("Active") : tr("Deactivated")}</Badge>
          <Badge>{categoryLabel(org.category)}</Badge>
          <Badge>{tr("{{tierLabel}} plan", { tierLabel: tierLabel })}</Badge>
          {org.products?.includes("recruitment") && <Badge>{org.products.includes("skills") ? tr("Skills + Recruitment") : tr("Recruitment only")}</Badge>}
          {org.pilotEndsAt && new Date(org.pilotEndsAt).getTime() > Date.now() && <Badge tone="warn">{tr("Pilot")}</Badge>}
        </>
      }
      stats={[
        recruitOnly
          ? { label: tr("Candidates"), value: candidates?.length ?? "—", hint: candidates ? tr("{{n}} finished", { n: candidates.filter((c) => c.status === "completed").length }) : undefined }
          : { label: tr("Learners"), value: org.learnerCount, hint: org.expectedLearnerCount ? tr("of {{expectedLearnerCount}} expected", { expectedLearnerCount: org.expectedLearnerCount }) : undefined },
        recruitOnly
          ? { label: tr("Batches"), value: batches.length, hint: tr("{{n}} open", { n: batches.filter((b) => b.status === "open").length }) }
          : { label: tr("Managers"), value: org.managers.length, hint: tr("{{managedLearners}} learners in their batches", { managedLearners: managedLearners }) },
        { label: tr("Account health"), value: org.health ? `${org.health.score}/100` : "—", hint: org.health?.flags[0] ?? (org.health ? tr("No issues") : undefined) },
        { label: tr("Org Admin"), value: org.orgAdminStatus === "active" ? "Active" : org.orgAdminStatus === "pending" ? "Invited" : "None", hint: org.orgAdmin?.name || org.orgAdmin?.email },
      ]}
      tabs={[
        { key: "overview", label: tr("Overview") },
        { key: "people", label: tr("People"), count: org.managers.length + (org.orgAdmin ? 1 : 0) },
        ...(recruits ? [{ key: "candidates", label: tr("Candidates"), count: candidates?.length }] : []),
        { key: "products", label: tr("Products & recruitment") },
        { key: "plan", label: tr("Plan & licenses") },
        { key: "billing", label: tr("Contract & billing") },
        { key: "proctoring", label: tr("Proctoring") },
        { key: "activity", label: tr("Activity") },
      ]}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
      wide
    >
      {tab === "overview" && (
        <div className="flex flex-col gap-6">
          <ModalSection title={tr("Company")} icon={Building2}>
            <InfoGrid
              items={[
                [tr("Legal name"), org.legalName],
                [tr("Type"), categoryLabel(org.category)],
                [tr("Industry"), org.industry],
                [tr("Employees"), org.employeeCountBand ? employeeCountLabel(org.employeeCountBand) : null],
                [tr("Website"), org.website],
                [tr("Phone"), org.phone],
                [tr("Country"), countryName(org.country, "en")],
                [tr("Address"), [org.addressLine, org.city, org.state, org.postalCode].filter(Boolean).join(", ") || null],
              ]}
            />
          </ModalSection>
          <ModalSection title={tr("Billing details")} icon={Receipt}>
            <InfoGrid
              items={[
                [
                  tr("Billing contact"),
                  org.billingContactName || org.billingContactEmail
                    ? [org.billingContactName, org.billingContactEmail, org.billingContactPhone].filter(Boolean).join(" · ")
                    : tr("Org Admin"),
                ],
                [tr("Tax ID"), org.taxId],
                [tr("PO / reference"), org.purchaseOrderRef],
                [tr("Expected learners"), org.expectedLearnerCount],
              ]}
            />
          </ModalSection>
          {org.trainingGoal && (
            <ModalSection title={tr("Training goal")} icon={Target}>
              <div className="bg-surface border border-rule rounded-card px-5 py-4 text-sm text-ink shadow-sm">{org.trainingGoal}</div>
            </ModalSection>
          )}
          {org.health && org.health.flags.length > 0 && (
            <ModalSection title={tr("What to watch")} icon={HeartPulse}>
              <div className="flex flex-col gap-2">
                {org.health.flags.map((f) => (
                  <div key={f} className="bg-surface border border-rule border-l-4 border-l-warning rounded-input px-4 py-2.5 text-sm text-ink">
                    {trServer(f)}
                  </div>
                ))}
              </div>
            </ModalSection>
          )}
        </div>
      )}

      {tab === "people" && (
        <div className="flex flex-col gap-6">
          <ModalSection title={tr("Org Admin")} icon={ShieldCheck}>
            {!org.orgAdmin ? (
              <ModalEmpty icon={ShieldCheck}>{tr("No Org Admin assigned yet.")}</ModalEmpty>
            ) : (
              <ModalRow
                initials={(org.orgAdmin.name.trim() || org.orgAdmin.email).slice(0, 2).toUpperCase()}
                title={org.orgAdmin.name.trim() || tr("Not named yet")}
                subtitle={[org.orgAdmin.jobTitle, org.orgAdmin.email, org.orgAdmin.phone].filter(Boolean).join(" · ")}
                right={<Pill tone={org.orgAdminStatus === "active" ? "good" : "warn"}>{org.orgAdminStatus === "active" ? tr("Active") : tr("Invite pending")}</Pill>}
                onClick={() => setViewingOrgAdminId(org.orgAdmin!.id)}
              />
            )}
            <OrgAdminRecovery tenantId={org.id} hasOrgAdmin={!!org.orgAdmin} onReplaced={() => onChanged?.()} />
          </ModalSection>
          <ModalSection title={tr("Managers ({{length}})", { length: org.managers.length })} icon={Users}>
            {org.managers.length === 0 ? (
              <ModalEmpty icon={Users}>{tr("No Managers yet.")}</ModalEmpty>
            ) : (
              <div className="grid md:grid-cols-2 gap-2">
                {org.managers.map((mgr) => (
                  <ModalRow
                    key={mgr.id}
                    initials={(mgr.name.trim() || mgr.email).slice(0, 2).toUpperCase()}
                    title={mgr.name.trim() || mgr.email}
                    subtitle={mgr.email}
                    right={<Pill>{mgr.learnerCount === 1 ? tr("1 learner") : tr("{{n}} learners", { n: mgr.learnerCount })}</Pill>}
                    onClick={() => setViewingManagerId(mgr.id)}
                  />
                ))}
              </div>
            )}
          </ModalSection>
        </div>
      )}

      {tab === "plan" && (
        <div className="flex flex-col gap-6">
          <OrgPlanAdminPanel tenantId={org.id} onTier={setPlanTier} />
          <OrgLicensesPanel tenantId={org.id} orgName={org.name} planTier={planTier} />
        </div>
      )}

      {tab === "billing" && <OrgCommercialPanel tenantId={org.id} hasOrgAdmin={!!org.orgAdmin} />}

      {tab === "candidates" && <OrgCandidatesPanel candidates={candidates} batches={batches} />}
      {tab === "products" && <OrgProductsPanel tenantId={org.id} onChanged={onChanged} />}

      {tab === "proctoring" && (
        <div className="flex flex-col gap-3">
          {org.products?.includes("recruitment") && <p className="text-sm text-muted">{tr("These settings apply to employees. Candidates' proctoring is under Products & recruitment.")}</p>}
          <ProctoringSettings load={loadProctoring} save={saveProctoring} />
        </div>
      )}

      {tab === "activity" && <OrgAuditPanel tenantId={org.id} />}

      {viewingOrgAdminId && <OrgAdminDetailModal orgAdminId={viewingOrgAdminId} onClose={onClose} onBack={() => setViewingOrgAdminId(null)} />}
      {viewingManagerId && <ManagerDetailModal managerId={viewingManagerId} onClose={onClose} onBack={() => setViewingManagerId(null)} />}
    </DetailModal>
  );
}
