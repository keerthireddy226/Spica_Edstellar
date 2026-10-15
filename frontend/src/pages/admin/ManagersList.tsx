import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Users, UserX } from "lucide-react";
import { getManagers as getManagerAccounts, type ManagerAccount } from "@/api/admin";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";
import { ago, shortDate } from "@/api/staff";
import { EmptyNote, FilterPills, PageHeader, SearchBox, SelectFilter, StatCard, StatusPill, paletteColor, useStaffPermissions } from "@/components/staff/StaffKit";

import { tr } from "@/i18n/tr";
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
      .catch(() => setError(tr("Could not load Managers.")));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">{tr("Loading…")}</p>;
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
      <PageHeader title={tr("Managers")} subtitle={tr("Managers run batches inside {{v}} organization{{v2}}. Their Org Admin adds and manages them.", { v: perms.isSuper ? "each" : "your", v2: perms.isSuper ? "" : "s" })} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="pastel" palette="sand" index={0} icon={ShieldCheck} value={rows.filter((m) => status(m) === "active").length} label={tr("Active Managers")} />
        <StatCard variant="pastel" palette="sand" index={1} icon={UserX} value={rows.filter((m) => status(m) === "pending").length} label={tr("Invite not accepted")} />
        <StatCard variant="pastel" palette="sand" index={2} icon={Users} value={rows.reduce((n, m) => n + m.learnerCount, 0)} label={tr("Learners in their batches")} sub={tr("{{reduce}} practised this week", { reduce: rows.reduce((n, m) => n + (m.activeLearners7d ?? 0), 0) })} />
        <StatCard
          variant="pastel"
          palette="sand"
          index={3}
          icon={KeyRound}
          value={`${rows.reduce((n, m) => n + (m.licensesUsed ?? 0), 0)} / ${rows.reduce((n, m) => n + (m.licensesAllotted ?? 0), 0)}`}
          label={tr("Pool licenses used")}
        />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder={tr("Search by name, email, organization or batch")} />
        <SelectFilter label={tr("Organization")} value={org} onChange={setOrg} options={[["all", tr("All organizations")], ...orgs]} />
        <FilterPills<F>
          value={filter}
          onChange={setFilter}
          options={[
            ["all", tr("All"), rows.length],
            ["active", tr("Active"), rows.filter((m) => status(m) === "active").length],
            ["pending", tr("Invite pending"), rows.filter((m) => status(m) === "pending").length],
            ["deactivated", tr("Deactivated"), rows.filter((m) => status(m) === "deactivated").length],
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyNote>{tr("No Managers match.")}</EmptyNote>
      ) : (
        <div className="grid lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {shown.map((m, i) => {
            const s = status(m);
            const left = m.licensesAllotted != null ? Math.max(0, m.licensesAllotted - (m.licensesUsed ?? 0)) : null;
            return (
              <div
                key={m.id}
                style={{ borderLeftColor: paletteColor("sand", i) }}
                className={`bg-surface rounded-card border border-rule border-l-[6px] shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3 ${m.active ? "" : "opacity-60"}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    style={{ background: `color-mix(in srgb, ${paletteColor("sand", i)} 18%, var(--color-surface))`, color: paletteColor("sand", i) }}
                    className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  >
                    {`${m.firstName?.[0] ?? ""}${m.lastName?.[0] ?? ""}`.toUpperCase() || m.email.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display font-bold text-ink truncate">{[m.firstName, m.lastName].filter(Boolean).join(" ") || tr("Not named yet")}</p>
                      <StatusPill tone={s === "active" ? "success" : s === "pending" ? "warning" : "error"}>
                        {s === "active" ? tr("Active") : s === "pending" ? tr("Invite pending") : tr("Deactivated")}
                      </StatusPill>
                    </div>
                    <p className="text-xs text-muted truncate">
                      {m.jobTitle ? `${m.jobTitle} · ` : ""}
                      {m.email} · {m.tenantName}
                    </p>
                  </div>
                  <button onClick={() => setViewing(m.id)} className="text-xs font-semibold text-navy hover:underline cursor-pointer shrink-0">
                    {tr("View details")}</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {m.batchNames.length === 0 ? (
                    <span className="text-xs text-muted italic">{tr("No batches yet")}</span>
                  ) : (
                    m.batchNames.map((b) => (
                      <span
                        key={b}
                        style={{ background: `color-mix(in srgb, ${paletteColor("sand", i)} 15%, var(--color-surface))`, color: `color-mix(in srgb, ${paletteColor("sand", i)} 75%, black)` }}
                        className="text-xs font-semibold px-2.5 py-1 rounded-pill"
                      >
                        {b}
                      </span>
                    ))
                  )}
                </div>
                <div className="grid grid-cols-3 divide-x divide-rule border-y border-rule py-2.5">
                  <div className="pr-3">
                    <p className="font-display font-bold text-xl text-ink">{m.learnerCount}</p>
                    <p className="text-[11px] text-muted">{tr("Learners")}</p>
                  </div>
                  <div className="px-3">
                    <p className="font-display font-bold text-xl text-ink">{m.activeLearners7d ?? 0}</p>
                    <p className="text-[11px] text-muted">{tr("Practised this week")}</p>
                  </div>
                  <div className="pl-3">
                    <p className="font-display font-bold text-xl text-ink">{left ?? "—"}</p>
                    <p className="text-[11px] text-muted">{left === null ? tr("No license pool") : tr("Pool left of {{licensesAllotted}}", { licensesAllotted: m.licensesAllotted })}</p>
                  </div>
                </div>
                <p className="text-xs text-muted">
                  {s === "pending" ? tr("Hasn't signed in yet") : tr("Last signed in {{ago}}", { ago: ago(m.lastLoginAt) })} {tr("· Added")}{" "}{shortDate(m.createdAt)}
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
