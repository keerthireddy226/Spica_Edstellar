import { useEffect, useState } from "react";
import { ShieldCheck, Building2, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";
import { getManagers, type ManagerAccount } from "@/api/admin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function categoryLabel(category: string | null): string {
  return category === "university" ? "University" : "Organization";
}

function ManagersSummary({ managers }: { managers: ManagerAccount[] }) {
  const totalManagers = managers.length;
  const orgsCovered = new Set(managers.map((m) => m.tenantName)).size;
  const totalLearners = managers.reduce((sum, m) => sum + m.learnerCount, 0);

  const cards: { label: string; value: number; icon: LucideIcon }[] = [
    { label: "Managers", value: totalManagers, icon: ShieldCheck },
    { label: "Organizations covered", value: orgsCovered, icon: Building2 },
    { label: "Learners managed", value: totalLearners, icon: Users },
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

// No "onboard" action here, same reason as Org Admins — a Manager account is
// created by an Org Admin from their own console, never directly by Super
// Admin. This page exists so a Super Admin can still see every Manager on
// the platform and who created each one's organization chain.
export function ManagersList() {
  const [managers, setManagers] = useState<ManagerAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingManagerId, setViewingManagerId] = useState<string | null>(null);

  useEffect(() => {
    getManagers()
      .then((res) => setManagers(res.managers))
      .catch(() => setError("Could not load managers."));
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Managers</h1>
        <p className="text-sm text-muted mt-1">Every Manager across every organization — each scoped to only their assigned batch(es).</p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {!managers && !error && <p className="text-sm text-muted">Loading…</p>}
      {managers?.length === 0 && <p className="text-sm text-muted">No managers onboarded yet.</p>}

      {managers && managers.length > 0 && (
        <>
          <ManagersSummary managers={managers} />
          <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Manager</th>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Batches</th>
                  <th className="px-4 py-3">Learners</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {managers.map((m) => {
                  const status = !m.active ? "deactivated" : !m.hasLoggedIn ? "pending" : "active";
                  return (
                    <tr key={m.id} className="border-b border-rule last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setViewingManagerId(m.id)}
                            title="View details"
                            className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0 cursor-pointer hover:ring-2 hover:ring-navy/40 transition-shadow"
                          >
                            {initials(m.firstName, m.lastName, m.email)}
                          </button>
                          <div className="min-w-0">
                            <p className="text-ink font-medium truncate">
                              {[m.firstName, m.lastName].filter(Boolean).join(" ") || "Not named yet"}
                            </p>
                            <p className="text-muted text-xs truncate">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink">{m.tenantName}</td>
                      <td className="px-4 py-3 text-muted">{categoryLabel(m.tenantCategory)}</td>
                      <td className="px-4 py-3 text-muted">{m.batchNames.length === 0 ? "—" : m.batchNames.join(", ")}</td>
                      <td className="px-4 py-3 text-muted">{m.learnerCount}</td>
                      <td className="px-4 py-3">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {viewingManagerId && <ManagerDetailModal managerId={viewingManagerId} onClose={() => setViewingManagerId(null)} />}
    </div>
  );
}
