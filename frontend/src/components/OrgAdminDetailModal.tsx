import { useEffect, useState } from "react";
import { Badge, Pill, DetailModal, InfoGrid, ModalEmpty, ModalRow, ModalSection, personInitials } from "@/components/DetailModal";
import { UserRound, Users } from "lucide-react";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";
import { getOrgAdminActivityDetail, type OrgAdminDetail, type OrgAdminOnboardedManager } from "@/api/admin";


import { tr } from "@/i18n/tr";
function categoryLabel(category: string | null): string {
  return category === "university" ? tr("University") : tr("Organization");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// An Org Admin's own detail view — reachable from the Org Admins list or
// nested inside an Admin's activity. Shows who they are, then every Manager
// they've onboarded, each itself clickable into ManagerDetailModal.
export function OrgAdminDetailModal({
  orgAdminId,
  onClose,
  onBack,
}: {
  orgAdminId: string;
  onClose: () => void;
  onBack?: () => void;
}) {
  const [orgAdmin, setOrgAdmin] = useState<OrgAdminDetail | null>(null);
  const [managers, setManagers] = useState<OrgAdminOnboardedManager[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingManagerId, setViewingManagerId] = useState<string | null>(null);

  useEffect(() => {
    getOrgAdminActivityDetail(orgAdminId)
      .then((res) => {
        setOrgAdmin(res.orgAdmin);
        setManagers(res.managers);
      })
      .catch(() => setError(tr("Could not load this org admin's details.")));
  }, [orgAdminId]);

  if (error) {
    return (
      <DetailModal title={tr("Org Admin details")} onClose={onClose} onBack={onBack}>
        <p className="text-sm text-error">{error}</p>
      </DetailModal>
    );
  }
  if (!orgAdmin || !managers) {
    return (
      <DetailModal title={tr("Org Admin details")} onClose={onClose} onBack={onBack}>
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      </DetailModal>
    );
  }

  const name = [orgAdmin.firstName, orgAdmin.lastName].filter(Boolean).join(" ") || tr("Not named yet");
  const status = !orgAdmin.active ? "deactivated" : !orgAdmin.hasLoggedIn ? "pending" : "active";
  const learnerTotal = managers.reduce((n, m) => n + m.learnerCount, 0);

  return (
    <DetailModal
      title={name}
      subtitle={tr("{{email}} · Org Admin at {{tenantName}}", { email: orgAdmin.email, tenantName: orgAdmin.tenantName })}
      initials={personInitials(orgAdmin.firstName, orgAdmin.lastName, orgAdmin.email)}
      badges={
        <>
          <Badge tone={status === "active" ? "good" : status === "pending" ? "warn" : "bad"}>
            {status === "active" ? tr("Active") : status === "pending" ? tr("Invite pending") : tr("Deactivated")}
          </Badge>
          <Badge>{categoryLabel(orgAdmin.tenantCategory)}</Badge>
          <Badge>{tr("Joined {{formatDate}}", { formatDate: formatDate(orgAdmin.createdAt) })}</Badge>
        </>
      }
      stats={[
        { label: tr("Managers"), value: managers.length, hint: `${managers.filter((m) => m.active && m.hasLoggedIn).length} active` },
        { label: tr("Learners under their Managers"), value: learnerTotal },
        { label: tr("Batches with a Manager"), value: new Set(managers.flatMap((m) => m.batchNames)).size },
        { label: tr("Invites not accepted"), value: managers.filter((m) => m.active && !m.hasLoggedIn).length },
      ]}
      onClose={onClose}
      onBack={onBack}
      wide
    >
      <div className="flex flex-col gap-6">
        <ModalSection title={tr("Details")} icon={UserRound}>
          <InfoGrid
            items={[
              [tr("Email"), orgAdmin.email],
              [tr("Organization"), `${orgAdmin.tenantName} (${categoryLabel(orgAdmin.tenantCategory)})`],
              [tr("Joined"), formatDate(orgAdmin.createdAt)],
              [tr("Signed in"), orgAdmin.hasLoggedIn ? tr("Yes") : tr("Not yet")],
            ]}
          />
        </ModalSection>

        <ModalSection title={tr("Managers ({{length}})", { length: managers.length })} icon={Users}>
          {managers.length === 0 ? (
            <ModalEmpty icon={Users}>{tr("Hasn't onboarded any Managers yet.")}</ModalEmpty>
          ) : (
            <div className="grid md:grid-cols-2 gap-2">
              {managers.map((m) => {
                const mStatus = !m.active ? "deactivated" : !m.hasLoggedIn ? "pending" : "active";
                return (
                  <ModalRow
                    key={m.id}
                    initials={personInitials(m.firstName, m.lastName, m.email)}
                    title={[m.firstName, m.lastName].filter(Boolean).join(" ") || m.email}
                    subtitle={[m.batchNames.length === 0 ? tr("No batch") : m.batchNames.join(", "), m.learnerCount === 1 ? tr("1 learner") : tr("{{n}} learners", { n: m.learnerCount })].join(" · ")}
                    right={
                      <Pill tone={mStatus === "active" ? "good" : mStatus === "pending" ? "warn" : "bad"}>
                        {mStatus === "active" ? tr("Active") : mStatus === "pending" ? tr("Invite pending") : tr("Deactivated")}
                      </Pill>
                    }
                    onClick={() => setViewingManagerId(m.id)}
                  />
                );
              })}
            </div>
          )}
        </ModalSection>
      </div>

      {viewingManagerId && (
        <ManagerDetailModal
          managerId={viewingManagerId}
          onClose={onClose}
          onBack={() => setViewingManagerId(null)}
        />
      )}
    </DetailModal>
  );
}
