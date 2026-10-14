import { useEffect, useState } from "react";
import { Building2, ShieldCheck, Users, UserX } from "lucide-react";
import { getOrgAdmins, type OrgAdminAccount } from "@/api/admin";
import { TIER_LABELS } from "@/api/plans";
import { OrgAdminDetailModal } from "@/components/OrgAdminDetailModal";
import { ago, shortDate } from "@/api/staff";
import { EmptyNote, FilterPills, PageHeader, SearchBox, StatCard, StatusPill, paletteColor, useStaffPermissions } from "@/components/staff/StaffKit";

type F = "all" | "active" | "pending" | "quiet" | "deactivated";
const status = (a: OrgAdminAccount): Exclude<F, "all" | "quiet"> => (!a.active ? "deactivated" : !a.hasLoggedIn ? "pending" : "active");
const quiet = (a: OrgAdminAccount) => a.active && a.hasLoggedIn && (!a.lastLoginAt || Date.now() - new Date(a.lastLoginAt).getTime() > 30 * 86400000);

// The one Org Admin of each organization the viewer can see.
export function OrgAdminsList() {
  const perms = useStaffPermissions();
  const [rows, setRows] = useState<OrgAdminAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<F>("all");

  useEffect(() => {
    getOrgAdmins()
      .then((r) => setRows(r.orgAdmins))
      .catch(() => setError("Could not load Org Admins."));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (a) =>
      (filter === "all" || (filter === "quiet" ? quiet(a) : status(a) === filter)) &&
      (!q || [a.firstName, a.lastName, a.email, a.tenantName, a.jobTitle, a.ownerName].some((v) => v?.toLowerCase().includes(q))),
  );

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title="Org Admins"
        subtitle={`The main contact at each ${perms.isSuper ? "" : "of your "}organization${perms.isSuper ? " and university" : "s"}. They manage batches, Managers, learners and licenses.`}
      />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="split" palette="moss" index={0} icon={ShieldCheck} value={rows.filter((a) => status(a) === "active").length} label="Active Org Admins" />
        <StatCard variant="split" palette="moss" index={1} icon={UserX} value={rows.filter((a) => status(a) === "pending").length} label="Invite not accepted" />
        <StatCard variant="split" palette="moss" index={2} icon={Building2} value={rows.filter(quiet).length} label="Not signed in for 30+ days" />
        <StatCard variant="split" palette="moss" index={3} icon={Users} value={rows.reduce((n, a) => n + a.learnerCount, 0)} label="Learners in their organizations" />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder="Search by name, email, organization or owner" />
        <FilterPills<F>
          value={filter}
          onChange={setFilter}
          options={[
            ["all", "All", rows.length],
            ["active", "Active", rows.filter((a) => status(a) === "active").length],
            ["pending", "Invite pending", rows.filter((a) => status(a) === "pending").length],
            ["quiet", "Quiet 30+ days", rows.filter(quiet).length],
            ["deactivated", "Deactivated", rows.filter((a) => status(a) === "deactivated").length],
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyNote>No Org Admins match.</EmptyNote>
      ) : (
        <div className="grid lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {shown.map((a, i) => {
            const s = status(a);
            return (
              <div key={a.id} className={`bg-surface rounded-card border border-rule shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col ${a.active ? "" : "opacity-60"}`}>
                <div
                  style={{ background: `linear-gradient(120deg, ${paletteColor("moss", i)}, color-mix(in srgb, ${paletteColor("moss", i)} 65%, black))` }}
                  className="px-5 py-4 text-white flex items-start gap-3"
                >
                  <span className="h-11 w-11 rounded-full bg-white/25 flex items-center justify-center text-sm font-bold shrink-0">
                    {`${a.firstName?.[0] ?? ""}${a.lastName?.[0] ?? ""}`.toUpperCase() || a.email.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display font-bold truncate">{[a.firstName, a.lastName].filter(Boolean).join(" ") || "Not named yet"}</p>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25 uppercase tracking-wide">
                        {s === "active" ? "Active" : s === "pending" ? "Invite pending" : "Deactivated"}
                      </span>
                    </div>
                    <p className="text-xs text-white/80 truncate">{a.tenantName}</p>
                  </div>
                  <button onClick={() => setViewing(a.id)} className="text-xs font-semibold hover:underline cursor-pointer shrink-0">
                    View details
                  </button>
                </div>
                <div className="px-5 py-4 flex flex-col gap-3">
                  <p className="text-xs text-muted truncate">
                    {a.jobTitle ? `${a.jobTitle} · ` : ""}
                    {a.email}
                    {a.phone ? ` · ${a.phone}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusPill tone="navy">{a.tenantCategory === "university" ? "University" : "Company"}</StatusPill>
                    {a.planTier && <StatusPill tone="success">{TIER_LABELS[a.planTier]}</StatusPill>}
                    {a.orgActive === false && <StatusPill tone="error">Organization deactivated</StatusPill>}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {(
                      [
                        [a.learnerCount, "Learners"],
                        [a.managers.length, "Managers"],
                        [a.activeBatches ?? 0, "Active batches"],
                      ] as const
                    ).map(([v, l]) => (
                      <div key={l} className="rounded-input bg-paper-warm px-3 py-2">
                        <p className="font-display font-bold text-xl text-ink">{v}</p>
                        <p className="text-[11px] text-muted">{l}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted">
                    {s === "pending" ? "Hasn't signed in yet" : `Last signed in ${ago(a.lastLoginAt)}`} · Added {shortDate(a.createdAt)}
                    {perms.isSuper && a.ownerName ? ` · Owner: ${a.ownerName}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">To resend an invite or replace an Org Admin, open their organization on the Organizations page.</p>
      {viewing && <OrgAdminDetailModal orgAdminId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
