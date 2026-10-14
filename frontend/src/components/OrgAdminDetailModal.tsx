import { useEffect, useState } from "react";
import { Badge, Pill, DetailModal, InfoGrid, ModalEmpty, ModalRow, ModalSection, personInitials } from "@/components/DetailModal";
import { UserRound, Users } from "lucide-react";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";
import { getOrgAdminActivityDetail, type OrgAdminDetail, type OrgAdminOnboardedManager } from "@/api/admin";


function categoryLabel(category: string | null): string {
  return category === "university" ? "University" : "Organization";
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
      .catch(() => setError("Could not load this org admin's details."));
  }, [orgAdminId]);

  if (error) {
    return (
      <DetailModal title="Org Admin details" onClose={onClose} onBack={onBack}>
        <p className="text-sm text-error">{error}</p>
      </DetailModal>
    );
  }
  if (!orgAdmin || !managers) {
    return (
      <DetailModal title="Org Admin details" onClose={onClose} onBack={onBack}>
        <p className="text-sm text-muted">Loading…</p>
      </DetailModal>
    );
  }

  const name = [orgAdmin.firstName, orgAdmin.lastName].filter(Boolean).join(" ") || "Not named yet";
  const status = !orgAdmin.active ? "deactivated" : !orgAdmin.hasLoggedIn ? "pending" : "active";
  const learnerTotal = managers.reduce((n, m) => n + m.learnerCount, 0);

  return (
    <DetailModal
      title={name}
      subtitle={`${orgAdmin.email} · Org Admin at ${orgAdmin.tenantName}`}
      initials={personInitials(orgAdmin.firstName, orgAdmin.lastName, orgAdmin.email)}
      badges={
        <>
          <Badge tone={status === "active" ? "good" : status === "pending" ? "warn" : "bad"}>
            {status === "active" ? "Active" : status === "pending" ? "Invite pending" : "Deactivated"}
          </Badge>
          <Badge>{categoryLabel(orgAdmin.tenantCategory)}</Badge>
          <Badge>Joined {formatDate(orgAdmin.createdAt)}</Badge>
        </>
      }
      stats={[
        { label: "Managers", value: managers.length, hint: `${managers.filter((m) => m.active && m.hasLoggedIn).length} active` },
        { label: "Learners under their Managers", value: learnerTotal },
        { label: "Batches with a Manager", value: new Set(managers.flatMap((m) => m.batchNames)).size },
        { label: "Invites not accepted", value: managers.filter((m) => m.active && !m.hasLoggedIn).length },
      ]}
      onClose={onClose}
      onBack={onBack}
      wide
    >
      <div className="flex flex-col gap-6">
        <ModalSection title="Details" icon={UserRound}>
          <InfoGrid
            items={[
              ["Email", orgAdmin.email],
              ["Organization", `${orgAdmin.tenantName} (${categoryLabel(orgAdmin.tenantCategory)})`],
              ["Joined", formatDate(orgAdmin.createdAt)],
              ["Signed in", orgAdmin.hasLoggedIn ? "Yes" : "Not yet"],
            ]}
          />
        </ModalSection>

        <ModalSection title={`Managers (${managers.length})`} icon={Users}>
          {managers.length === 0 ? (
            <ModalEmpty icon={Users}>Hasn't onboarded any Managers yet.</ModalEmpty>
          ) : (
            <div className="grid md:grid-cols-2 gap-2">
              {managers.map((m) => {
                const mStatus = !m.active ? "deactivated" : !m.hasLoggedIn ? "pending" : "active";
                return (
                  <ModalRow
                    key={m.id}
                    initials={personInitials(m.firstName, m.lastName, m.email)}
                    title={[m.firstName, m.lastName].filter(Boolean).join(" ") || m.email}
                    subtitle={`${m.batchNames.length === 0 ? "No batch" : m.batchNames.join(", ")} · ${m.learnerCount} learner${m.learnerCount === 1 ? "" : "s"}`}
                    right={
                      <Pill tone={mStatus === "active" ? "good" : mStatus === "pending" ? "warn" : "bad"}>
                        {mStatus === "active" ? "Active" : mStatus === "pending" ? "Invite pending" : "Deactivated"}
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
