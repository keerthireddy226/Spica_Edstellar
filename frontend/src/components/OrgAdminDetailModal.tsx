import { useEffect, useState } from "react";
import { DetailModal } from "@/components/DetailModal";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";
import { getOrgAdminActivityDetail, type OrgAdminDetail, type OrgAdminOnboardedManager } from "@/api/admin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

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

  return (
    <DetailModal title={name} subtitle={`Org Admin at ${orgAdmin.tenantName}`} onClose={onClose} onBack={onBack} wide>
      <div className="flex flex-col gap-4">
        <div className="border border-rule rounded-input px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Org Admin details</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted">Email</p>
              <p className="text-sm text-ink">{orgAdmin.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Organization</p>
              <p className="text-sm text-ink">
                {orgAdmin.tenantName} ({categoryLabel(orgAdmin.tenantCategory)})
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Joined</p>
              <p className="text-sm text-ink">{formatDate(orgAdmin.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Status</p>
              <span
                className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-pill mt-0.5 ${
                  status === "active" ? "bg-success/15 text-success" : status === "pending" ? "bg-warning/15 text-navy-deep" : "bg-error/15 text-error"
                }`}
              >
                {status === "active" ? "Active" : status === "pending" ? "Invite pending" : "Deactivated"}
              </span>
            </div>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Managers onboarded</p>
          {managers.length === 0 ? (
            <p className="text-sm text-muted">Hasn't onboarded any managers yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {managers.map((m) => {
                const mStatus = !m.active ? "deactivated" : !m.hasLoggedIn ? "pending" : "active";
                return (
                  <button
                    key={m.id}
                    onClick={() => setViewingManagerId(m.id)}
                    className="border border-rule rounded-input px-4 py-3 flex items-center gap-3 text-left hover:border-rule-strong hover:bg-paper-warm transition-colors cursor-pointer"
                  >
                    <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                      {initials(m.firstName, m.lastName, m.email)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{[m.firstName, m.lastName].filter(Boolean).join(" ") || m.email}</p>
                      <p className="text-xs text-muted">
                        {m.batchNames.length === 0 ? "No batch assigned" : m.batchNames.join(", ")} · {m.learnerCount} learner{m.learnerCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-pill shrink-0 ${
                        mStatus === "active" ? "bg-success/15 text-success" : mStatus === "pending" ? "bg-warning/15 text-navy-deep" : "bg-error/15 text-error"
                      }`}
                    >
                      {mStatus === "active" ? "Active" : mStatus === "pending" ? "Invite pending" : "Deactivated"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {viewingManagerId && (
        <ManagerDetailModal
          managerId={viewingManagerId}
          onClose={() => setViewingManagerId(null)}
          onBack={() => setViewingManagerId(null)}
        />
      )}
    </DetailModal>
  );
}
