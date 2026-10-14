import { useState } from "react";
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

function categoryLabel(category: string | null): string {
  return category === "university" ? "University" : "Organization";
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
  const managedLearners = org.managers.reduce((n, m) => n + m.learnerCount, 0);
  const tierLabel = planTier.charAt(0).toUpperCase() + planTier.slice(1);

  return (
    <DetailModal
      title={org.name}
      subtitle={[org.legalName, org.industry, countryName(org.country, "en") !== "—" ? countryName(org.country, "en") : null].filter(Boolean).join(" · ") || categoryLabel(org.category)}
      icon={org.category === "university" ? GraduationCap : Building2}
      badges={
        <>
          <Badge tone={org.active ? "good" : "bad"}>{org.active ? "Active" : "Deactivated"}</Badge>
          <Badge>{categoryLabel(org.category)}</Badge>
          <Badge>{tierLabel} plan</Badge>
          {org.pilotEndsAt && new Date(org.pilotEndsAt).getTime() > Date.now() && <Badge tone="warn">Pilot</Badge>}
        </>
      }
      stats={[
        { label: "Learners", value: org.learnerCount, hint: org.expectedLearnerCount ? `of ${org.expectedLearnerCount} expected` : undefined },
        { label: "Managers", value: org.managers.length, hint: `${managedLearners} learners in their batches` },
        { label: "Account health", value: org.health ? `${org.health.score}/100` : "—", hint: org.health?.flags[0] ?? (org.health ? "No issues" : undefined) },
        { label: "Org Admin", value: org.orgAdminStatus === "active" ? "Active" : org.orgAdminStatus === "pending" ? "Invited" : "None", hint: org.orgAdmin?.name || org.orgAdmin?.email },
      ]}
      tabs={[
        { key: "overview", label: "Overview" },
        { key: "people", label: "People", count: org.managers.length + (org.orgAdmin ? 1 : 0) },
        { key: "plan", label: "Plan & licenses" },
        { key: "billing", label: "Contract & billing" },
        { key: "activity", label: "Activity" },
      ]}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
      wide
    >
      {tab === "overview" && (
        <div className="flex flex-col gap-6">
          <ModalSection title="Company" icon={Building2}>
            <InfoGrid
              items={[
                ["Legal name", org.legalName],
                ["Type", categoryLabel(org.category)],
                ["Industry", org.industry],
                ["Employees", org.employeeCountBand ? employeeCountLabel(org.employeeCountBand) : null],
                ["Website", org.website],
                ["Phone", org.phone],
                ["Country", countryName(org.country, "en")],
                ["Address", [org.addressLine, org.city, org.state, org.postalCode].filter(Boolean).join(", ") || null],
              ]}
            />
          </ModalSection>
          <ModalSection title="Billing details" icon={Receipt}>
            <InfoGrid
              items={[
                [
                  "Billing contact",
                  org.billingContactName || org.billingContactEmail
                    ? [org.billingContactName, org.billingContactEmail, org.billingContactPhone].filter(Boolean).join(" · ")
                    : "Org Admin",
                ],
                ["Tax ID", org.taxId],
                ["PO / reference", org.purchaseOrderRef],
                ["Expected learners", org.expectedLearnerCount],
              ]}
            />
          </ModalSection>
          {org.trainingGoal && (
            <ModalSection title="Training goal" icon={Target}>
              <div className="bg-surface border border-rule rounded-card px-5 py-4 text-sm text-ink shadow-sm">{org.trainingGoal}</div>
            </ModalSection>
          )}
          {org.health && org.health.flags.length > 0 && (
            <ModalSection title="What to watch" icon={HeartPulse}>
              <div className="flex flex-col gap-2">
                {org.health.flags.map((f) => (
                  <div key={f} className="bg-surface border border-rule border-l-4 border-l-warning rounded-input px-4 py-2.5 text-sm text-ink">
                    {f}
                  </div>
                ))}
              </div>
            </ModalSection>
          )}
        </div>
      )}

      {tab === "people" && (
        <div className="flex flex-col gap-6">
          <ModalSection title="Org Admin" icon={ShieldCheck}>
            {!org.orgAdmin ? (
              <ModalEmpty icon={ShieldCheck}>No Org Admin assigned yet.</ModalEmpty>
            ) : (
              <ModalRow
                initials={(org.orgAdmin.name.trim() || org.orgAdmin.email).slice(0, 2).toUpperCase()}
                title={org.orgAdmin.name.trim() || "Not named yet"}
                subtitle={[org.orgAdmin.jobTitle, org.orgAdmin.email, org.orgAdmin.phone].filter(Boolean).join(" · ")}
                right={<Pill tone={org.orgAdminStatus === "active" ? "good" : "warn"}>{org.orgAdminStatus === "active" ? "Active" : "Invite pending"}</Pill>}
                onClick={() => setViewingOrgAdminId(org.orgAdmin!.id)}
              />
            )}
            <OrgAdminRecovery tenantId={org.id} hasOrgAdmin={!!org.orgAdmin} onReplaced={() => onChanged?.()} />
          </ModalSection>
          <ModalSection title={`Managers (${org.managers.length})`} icon={Users}>
            {org.managers.length === 0 ? (
              <ModalEmpty icon={Users}>No Managers yet.</ModalEmpty>
            ) : (
              <div className="grid md:grid-cols-2 gap-2">
                {org.managers.map((mgr) => (
                  <ModalRow
                    key={mgr.id}
                    initials={(mgr.name.trim() || mgr.email).slice(0, 2).toUpperCase()}
                    title={mgr.name.trim() || mgr.email}
                    subtitle={mgr.email}
                    right={<Pill>{`${mgr.learnerCount} learner${mgr.learnerCount === 1 ? "" : "s"}`}</Pill>}
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

      {tab === "activity" && <OrgAuditPanel tenantId={org.id} />}

      {viewingOrgAdminId && <OrgAdminDetailModal orgAdminId={viewingOrgAdminId} onClose={onClose} onBack={() => setViewingOrgAdminId(null)} />}
      {viewingManagerId && <ManagerDetailModal managerId={viewingManagerId} onClose={onClose} onBack={() => setViewingManagerId(null)} />}
    </DetailModal>
  );
}
