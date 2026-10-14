import { useState } from "react";
import { DetailModal } from "@/components/DetailModal";
import { OrgAdminDetailModal } from "@/components/OrgAdminDetailModal";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";
import type { AdminConsoleOrg } from "@/api/admin";

function categoryLabel(category: string | null): string {
  return category === "university" ? "University" : "Organization";
}

// An organization's own detail view, opened straight from the Admin
// console's Organizations table — data is already loaded there, so no
// fetch here, just the same Org Admin / Manager drill-down used everywhere
// else (shared OrgAdminDetailModal / ManagerDetailModal).
export function OrganizationDetailModal({ org, onClose }: { org: AdminConsoleOrg; onClose: () => void }) {
  const [viewingOrgAdminId, setViewingOrgAdminId] = useState<string | null>(null);
  const [viewingManagerId, setViewingManagerId] = useState<string | null>(null);

  return (
    <DetailModal
      title={org.name}
      subtitle={`${categoryLabel(org.category)} · ${org.learnerCount} learner${org.learnerCount === 1 ? "" : "s"}`}
      onClose={onClose}
      wide
    >
      <div className="flex flex-col gap-4">
        <div className="border border-rule rounded-input px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Organization details</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted">Type</p>
              <p className="text-sm text-ink">{categoryLabel(org.category)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Learners</p>
              <p className="text-sm text-ink">{org.learnerCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Status</p>
              <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-pill mt-0.5 ${org.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                {org.active ? "Active" : "Deactivated"}
              </span>
            </div>
          </div>
        </div>

        <div className="border border-rule rounded-input px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Org Admin</p>
          {!org.orgAdmin ? (
            <p className="text-sm text-muted">No Org Admin assigned yet.</p>
          ) : (
            <button
              onClick={() => setViewingOrgAdminId(org.orgAdmin!.id)}
              className="flex items-center gap-2.5 text-sm w-full text-left hover:bg-paper-warm rounded-input px-2 py-1.5 -mx-2 transition-colors cursor-pointer"
            >
              <span className="h-8 w-8 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                {(org.orgAdmin.name.trim() || org.orgAdmin.email).slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-ink">{org.orgAdmin.name.trim() || "Not named yet"}</span>
                <span className="text-muted text-xs ml-2">{org.orgAdmin.email}</span>
              </div>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-pill shrink-0 ${
                  org.orgAdminStatus === "active" ? "bg-success/15 text-success" : "bg-warning/15 text-navy-deep"
                }`}
              >
                {org.orgAdminStatus === "active" ? "Active" : "Invite pending"}
              </span>
            </button>
          )}
        </div>

        <div className="border border-rule rounded-input px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Managers onboarded</p>
          {org.managers.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {org.managers.map((mgr) => (
                <button
                  key={mgr.id}
                  onClick={() => setViewingManagerId(mgr.id)}
                  className="flex items-center gap-2.5 text-sm w-full text-left hover:bg-paper-warm rounded-input px-2 py-1.5 -mx-2 transition-colors cursor-pointer"
                >
                  <span className="h-7 w-7 rounded-full bg-navy text-lime flex items-center justify-center text-[10px] font-bold shrink-0">
                    {(mgr.name.trim() || mgr.email).slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-ink">{mgr.name.trim() || mgr.email}</span>
                    <span className="text-muted text-xs ml-2">{mgr.email}</span>
                  </div>
                  <span className="text-xs text-muted shrink-0">
                    {mgr.learnerCount} learner{mgr.learnerCount === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewingOrgAdminId && (
        <OrgAdminDetailModal
          orgAdminId={viewingOrgAdminId}
          onClose={() => setViewingOrgAdminId(null)}
          onBack={() => setViewingOrgAdminId(null)}
        />
      )}
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
