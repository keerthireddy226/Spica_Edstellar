import { useEffect, useState } from "react";
import { Building2, Users, GraduationCap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { OrgAdminDetailModal } from "@/components/OrgAdminDetailModal";
import { getOrgAdmins, type OrgAdminAccount } from "@/api/admin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function categoryLabel(category: string | null): string {
  return category === "university" ? "University" : "Organization";
}

function OrgAdminsSummary({ orgAdmins }: { orgAdmins: OrgAdminAccount[] }) {
  const uniqueTenants = new Map(orgAdmins.map((a) => [a.tenantId, a.tenantCategory]));
  const organizationCount = [...uniqueTenants.values()].filter((c) => c !== "university").length;
  const universityCount = [...uniqueTenants.values()].filter((c) => c === "university").length;
  const totalLearners = orgAdmins.reduce((sum, a) => sum + a.learnerCount, 0);

  const cards: { label: string; value: number; icon: LucideIcon }[] = [
    { label: "Organizations", value: organizationCount, icon: Building2 },
    { label: "Universities", value: universityCount, icon: GraduationCap },
    { label: "Learners from org/uni", value: totalLearners, icon: Users },
  ];

  return (
    <div className="grid sm:grid-cols-3 gap-4">
      {cards.map(({ label, value, icon: Icon }, i) => (
        <div key={label} style={cardGradient(i)} className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4">
          <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
            <Icon size={22} strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-2xl font-display font-bold text-white">{value}</p>
            <p className="text-xs text-white/80">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// No "onboard" action here on purpose — an Org Admin account is created as
// part of an Admin creating the organization itself, not directly by a
// Super Admin in isolation (see the spec's B2B onboarding flow).
export function OrgAdminsList() {
  const [orgAdmins, setOrgAdmins] = useState<OrgAdminAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingOrgAdminId, setViewingOrgAdminId] = useState<string | null>(null);

  useEffect(() => {
    getOrgAdmins()
      .then((res) => setOrgAdmins(res.orgAdmins))
      .catch(() => setError("Could not load org admins."));
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Org Admins</h1>
        <p className="text-sm text-muted mt-1">A real contact at each client organization or university.</p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {!orgAdmins && !error && <p className="text-sm text-muted">Loading…</p>}
      {orgAdmins?.length === 0 && <p className="text-sm text-muted">No organizations onboarded yet.</p>}

      {orgAdmins && orgAdmins.length > 0 && (
        <>
          <OrgAdminsSummary orgAdmins={orgAdmins} />
          <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Org Admin</th>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Learners</th>
                  <th className="px-4 py-3">Managers</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {orgAdmins.map((a) => (
                  <tr key={a.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setViewingOrgAdminId(a.id)}
                          title="View details"
                          className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0 cursor-pointer hover:ring-2 hover:ring-navy/40 transition-shadow"
                        >
                          {initials(a.firstName, a.lastName, a.email)}
                        </button>
                        <div className="min-w-0">
                          <p className="text-ink font-medium truncate">
                            {[a.firstName, a.lastName].filter(Boolean).join(" ") || "Not named yet"}
                          </p>
                          <p className="text-muted text-xs truncate">{a.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink">{a.tenantName}</td>
                    <td className="px-4 py-3 text-muted">{categoryLabel(a.tenantCategory)}</td>
                    <td className="px-4 py-3 text-muted">{a.learnerCount}</td>
                    <td className="px-4 py-3 text-muted">
                      {a.managers.length === 0
                        ? "—"
                        : a.managers.map((m) => `${m.name.trim() || "Unnamed"} (${m.learnerCount})`).join(", ")}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const status = !a.active ? "deactivated" : !a.hasLoggedIn ? "pending" : "active";
                        return (
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                              status === "active"
                                ? "bg-success/15 text-success"
                                : status === "pending"
                                  ? "bg-warning/15 text-navy-deep"
                                  : "bg-error/15 text-error"
                            }`}
                          >
                            {status === "active" ? "Active" : status === "pending" ? "Invite pending" : "Deactivated"}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {viewingOrgAdminId && <OrgAdminDetailModal orgAdminId={viewingOrgAdminId} onClose={() => setViewingOrgAdminId(null)} />}
    </div>
  );
}
