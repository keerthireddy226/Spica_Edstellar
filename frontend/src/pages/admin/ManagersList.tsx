import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Users, UserX } from "lucide-react";
import { getManagers as getManagerAccounts, type ManagerAccount } from "@/api/admin";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";
import { ago, shortDate } from "@/api/staff";
import { cardGradient } from "@/lib/cardGradients";
import { EmptyNote, FilterPills, PageHeader, SearchBox, SelectFilter, StatCard, useStaffPermissions } from "@/components/staff/StaffKit";

type F = "all" | "active" | "pending" | "deactivated";
const status = (m: ManagerAccount): Exclude<F, "all"> => (!m.active ? "deactivated" : !m.hasLoggedIn ? "pending" : "active");

// Every Manager in the organizations the viewer can see. Org Admins create
// and manage them; staff look.
export function ManagersList() {
  const perms = useStaffPermissions();
  const [rows, setRows] = useState<ManagerAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<F>("all");
  const [org, setOrg] = useState("all");

  useEffect(() => {
    getManagerAccounts()
      .then((r) => setRows(r.managers))
      .catch(() => setError("Could not load Managers."));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  const orgs = [...new Set(rows.map((m) => m.tenantName))].sort().map((n) => [n, n] as [string, string]);
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (m) =>
      (filter === "all" || status(m) === filter) &&
      (org === "all" || m.tenantName === org) &&
      (!q || [m.firstName, m.lastName, m.email, m.tenantName, m.jobTitle, ...m.batchNames].some((v) => v?.toLowerCase().includes(q))),
  );

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title="Managers" subtitle={`Managers run batches inside ${perms.isSuper ? "each" : "your"} organization${perms.isSuper ? "" : "s"}. Their Org Admin adds and manages them.`} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard index={0} icon={ShieldCheck} value={rows.filter((m) => status(m) === "active").length} label="Active Managers" />
        <StatCard index={1} icon={UserX} value={rows.filter((m) => status(m) === "pending").length} label="Invite not accepted" />
        <StatCard index={2} icon={Users} value={rows.reduce((n, m) => n + m.learnerCount, 0)} label="Learners in their batches" sub={`${rows.reduce((n, m) => n + (m.activeLearners7d ?? 0), 0)} practised this week`} />
        <StatCard
          index={3}
          icon={KeyRound}
          value={`${rows.reduce((n, m) => n + (m.licensesUsed ?? 0), 0)} / ${rows.reduce((n, m) => n + (m.licensesAllotted ?? 0), 0)}`}
          label="Pool licenses used"
        />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder="Search by name, email, organization or batch" />
        <SelectFilter label="Organization" value={org} onChange={setOrg} options={[["all", "All organizations"], ...orgs]} />
        <FilterPills<F>
          value={filter}
          onChange={setFilter}
          options={[
            ["all", "All", rows.length],
            ["active", "Active", rows.filter((m) => status(m) === "active").length],
            ["pending", "Invite pending", rows.filter((m) => status(m) === "pending").length],
            ["deactivated", "Deactivated", rows.filter((m) => status(m) === "deactivated").length],
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyNote>No Managers match.</EmptyNote>
      ) : (
        <div className="grid lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {shown.map((m, i) => {
            const s = status(m);
            const left = m.licensesAllotted != null ? Math.max(0, m.licensesAllotted - (m.licensesUsed ?? 0)) : null;
            return (
              <div key={m.id} style={cardGradient(i)} className={`rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3 text-white ${m.active ? "" : "opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <span className="h-11 w-11 rounded-full bg-white/25 flex items-center justify-center text-sm font-bold shrink-0">
                    {`${m.firstName?.[0] ?? ""}${m.lastName?.[0] ?? ""}`.toUpperCase() || m.email.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display font-bold truncate">{[m.firstName, m.lastName].filter(Boolean).join(" ") || "Not named yet"}</p>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25 uppercase tracking-wide">
                        {s === "active" ? "Active" : s === "pending" ? "Invite pending" : "Deactivated"}
                      </span>
                    </div>
                    <p className="text-xs text-white/80 truncate">
                      {m.jobTitle ? `${m.jobTitle} · ` : ""}
                      {m.email} · {m.tenantName}
                    </p>
                  </div>
                  <button onClick={() => setViewing(m.id)} className="text-xs font-semibold hover:underline cursor-pointer shrink-0">
                    View details
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {m.batchNames.length === 0 ? (
                    <span className="text-xs text-white/75 italic">No batches yet</span>
                  ) : (
                    m.batchNames.map((b) => (
                      <span key={b} className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-white/20">
                        {b}
                      </span>
                    ))
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 bg-black/10 rounded-input px-3.5 py-3">
                  <div>
                    <p className="font-display font-bold text-xl">{m.learnerCount}</p>
                    <p className="text-[11px] text-white/75">Learners</p>
                  </div>
                  <div>
                    <p className="font-display font-bold text-xl">{m.activeLearners7d ?? 0}</p>
                    <p className="text-[11px] text-white/75">Practised this week</p>
                  </div>
                  <div>
                    <p className="font-display font-bold text-xl">{left ?? "—"}</p>
                    <p className="text-[11px] text-white/75">{left === null ? "No license pool" : `Pool left of ${m.licensesAllotted}`}</p>
                  </div>
                </div>
                <p className="text-xs text-white/80">
                  {s === "pending" ? "Hasn't signed in yet" : `Last signed in ${ago(m.lastLoginAt)}`} · Added {shortDate(m.createdAt)}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {viewing && <ManagerDetailModal managerId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
