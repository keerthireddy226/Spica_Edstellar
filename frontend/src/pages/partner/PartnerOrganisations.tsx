import { useEffect, useState } from "react";
import { Building2, Check, Minus, Plus, Search, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/Button";
import { EmptyNote, Notice, PageError, PageHeader, PageLoading, StatusPill } from "@/components/staff/StaffKit";
import { DetailModal } from "@/components/DetailModal";
import { AddOrganisation, GiveLicences, type PartnerOrg } from "@/pages/partner/PartnerDashboard";
import { money } from "@/pages/partner/PartnerOrders";
import { tr } from "@/i18n/tr";

// Channel Partner portal: every organisation the partner onboarded, and one
// organisation's admin, learners (licence and whether they finished the mock
// test / a real test — never scores) and orders.
interface Me {
  demo: { total: number; given: number; left: number; status: "not_started" | "active" | "ended"; endsAt: string | null };
}
interface Detail {
  organisation: PartnerOrg;
  admin: { name: string; email: string; phone?: string | null; invitePending: boolean; lastSignIn: string | null } | null;
  learners: { id: string; name: string; email: string; addedAt: string; licence: "demo" | "paid" | "none"; licenceEndsAt: string | null; licenceActive: boolean; started: boolean; mockDone: boolean; finalDone: boolean }[];
  orders: { id: string; orderNumber: string; status: string; total: number; currency: string; validUntil: string; licences: number }[];
}

const day = (s: string | null) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const input = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm focus:outline-none focus:border-navy";
const ORDER_STATUS: Record<string, string> = {
  draft: tr("Draft"),
  submitted: tr("Submitted"),
  proforma_sent: tr("Proforma sent"),
  payment_received: tr("Payment received"),
  confirmed: tr("Confirmed"),
  allocated: tr("Allocated"),
  active: tr("Active"),
  expired: tr("Expired"),
  cancelled: tr("Cancelled"),
};
const YesNo = ({ yes }: { yes: boolean }) => (yes ? <Check size={16} className="text-success" aria-label={tr("Yes")} /> : <Minus size={16} className="text-muted" aria-label={tr("No")} />);

export function OrganisationsTable({ orgs, onOpen, onGive, canGive }: { orgs: PartnerOrg[]; onOpen: (o: PartnerOrg) => void; onGive: (o: PartnerOrg) => void; canGive: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide">
          <tr>
            {[tr("Organisation"), tr("Admin"), tr("Demo licences"), tr("Paid licences in use"), tr("Learners"), tr("Orders"), tr("Added"), ""].map((h, i) => (
              <th key={i} className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orgs.map((o) => (
            <tr key={o.id} className="border-t border-rule hover:bg-paper-warm/50 cursor-pointer" onClick={() => onOpen(o)}>
              <td className="px-4 py-3">
                <p className="font-semibold text-navy min-w-40">{o.name}</p>
                <p className="text-xs text-muted">{o.category === "company" ? tr("Company") : tr("University or college")}</p>
              </td>
              <td className="px-4 py-3">
                <p>{o.admin.name || "—"}</p>
                <p className="text-xs text-muted">{o.admin.email}</p>
                {o.admin.invitePending && <StatusPill tone="warning">{tr("Invite pending")}</StatusPill>}
              </td>
              <td className="px-4 py-3">
                <p>{tr("{{used}} of {{n}} used", { used: o.demoUsed, n: o.demoLicences })}</p>
                <p className="text-xs text-muted">{tr("{{n}} learners started", { n: o.demoStarted })}</p>
              </td>
              <td className="px-4 py-3">{o.paidAssigned ?? 0}</td>
              <td className="px-4 py-3">{o.learners}</td>
              <td className="px-4 py-3 whitespace-nowrap">{o.orders ? tr("{{n}} ({{c}} confirmed)", { n: o.orders, c: o.ordersConfirmed ?? 0 }) : "—"}</td>
              <td className="px-4 py-3 text-muted whitespace-nowrap">{day(o.createdAt)}</td>
              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                <Button variant="secondary" disabled={!canGive || !o.active} onClick={() => onGive(o)} className="!px-3 !py-1.5 whitespace-nowrap">
                  {tr("Give licences")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OrganisationDetail({ org, canGive, onGive, onClose }: { org: PartnerOrg; canGive: boolean; onGive: () => void; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    api<Detail>(`/partner/organisations/${org.id}`).then(setD).catch(() => setErr(true));
  }, [org.id]);
  const learners = (d?.learners ?? []).filter((l) => !q.trim() || `${l.name} ${l.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <DetailModal title={org.name} subtitle={org.category === "company" ? tr("Company") : tr("University or college")} icon={Building2} onClose={onClose} wide>
      {err ? (
        <Notice tone="error">{tr("Could not load this organisation.")}</Notice>
      ) : !d ? (
        <PageLoading />
      ) : (
        <div className="flex flex-col gap-5 text-sm">
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="border border-rule rounded-input p-3">
              <p className="text-xs text-muted uppercase tracking-wide font-semibold">{tr("Admin")}</p>
              {d.admin ? (
                <>
                  <p className="font-semibold">{d.admin.name || "—"}</p>
                  <p className="text-muted">{d.admin.email}</p>
                  {d.admin.phone && <p className="text-muted">{d.admin.phone}</p>}
                  <p className="text-xs mt-1">{d.admin.invitePending ? <StatusPill tone="warning">{tr("Invite pending")}</StatusPill> : tr("Last sign-in {{d}}", { d: day(d.admin.lastSignIn) })}</p>
                </>
              ) : (
                <p className="text-muted">—</p>
              )}
            </div>
            <div className="border border-rule rounded-input p-3">
              <p className="text-xs text-muted uppercase tracking-wide font-semibold">{tr("Demo licences")}</p>
              <p className="font-semibold">{tr("{{used}} of {{n}} used", { used: org.demoUsed, n: org.demoLicences })}</p>
              <p className="text-muted">{tr("{{s}} started · {{p}} practice tests and {{m}} mock tests finished", { s: org.demoStarted, p: org.practiceDone, m: org.mocksDone })}</p>
              {(org.allocations ?? []).map((a, i) => (
                <p key={i} className="text-xs text-muted">
                  {a.validUntil ? tr("{{n}} given {{g}} · valid until {{d}}", { n: a.licences, g: day(a.givenAt), d: day(a.validUntil) }) : tr("{{n}} given {{g}}", { n: a.licences, g: day(a.givenAt) })}
                </p>
              ))}
            </div>
            <div className="border border-rule rounded-input p-3">
              <p className="text-xs text-muted uppercase tracking-wide font-semibold">{tr("Learners")}</p>
              <p className="font-semibold">{tr("{{n}} added", { n: d.learners.length })}</p>
              <p className="text-muted">{tr("{{n}} with a paid licence in use", { n: org.paidAssigned ?? 0 })}</p>
            </div>
          </div>

          {org.details && Object.values(org.details).some((v) => v !== null && v !== "") && (
            <div className="border border-rule rounded-input p-3 grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {[org.details.address, org.details.city, org.details.state, org.details.postalCode, org.details.country].some(Boolean) && (
                <p><b>{tr("Location")}:</b> {[org.details.address, org.details.city, org.details.state, org.details.postalCode, org.details.country].filter(Boolean).join(", ")}</p>
              )}
              {org.details.website && <p><b>{tr("Website")}:</b> {org.details.website}</p>}
              {org.details.phone && <p><b>{tr("Organisation phone")}:</b> {org.details.phone}</p>}
              {org.details.expectedLearners != null && <p><b>{tr("Expected number of learners")}:</b> {org.details.expectedLearners}</p>}
              {org.details.gstin && <p><b>GSTIN:</b> {org.details.gstin}</p>}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display font-bold text-base flex items-center gap-2">
                <Users size={16} /> {tr("Learners")}
              </h3>
              {d.learners.length > 8 && (
                <label className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input className={`${input} !pl-8 !py-1.5 w-56`} placeholder={tr("Search by name or email")} value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
              )}
            </div>
            {d.learners.length === 0 ? (
              <EmptyNote>{tr("No learners yet. The organisation's admin adds them.")}</EmptyNote>
            ) : (
              <div className="overflow-x-auto border border-rule rounded-input max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide sticky top-0">
                    <tr>
                      {[tr("Learner"), tr("Licence"), tr("Ends"), tr("Started"), tr("Mock test done"), tr("Real test done")].map((h) => (
                        <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {learners.map((l) => (
                      <tr key={l.id} className="border-t border-rule">
                        <td className="px-3 py-2">
                          <p className="font-semibold">{l.name || "—"}</p>
                          <p className="text-xs text-muted">{l.email}</p>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {l.licence === "none" ? (
                            <span className="text-muted">{tr("No licence")}</span>
                          ) : (
                            <StatusPill tone={l.licenceActive ? (l.licence === "paid" ? "success" : "navy") : "muted"}>
                              {l.licence === "paid" ? (l.licenceActive ? tr("Paid") : tr("Paid, ended")) : l.licenceActive ? tr("Demo") : tr("Demo ended")}
                            </StatusPill>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted">{day(l.licenceEndsAt)}</td>
                        <td className="px-3 py-2"><YesNo yes={l.started} /></td>
                        <td className="px-3 py-2"><YesNo yes={l.mockDone} /></td>
                        <td className="px-3 py-2"><YesNo yes={l.finalDone} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted">{tr("You see names, licences and whether tests are done. Scores and reports stay with the organisation.")}</p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="font-display font-bold text-base">{tr("Orders")}</h3>
            {d.orders.length === 0 ? (
              <EmptyNote>{tr("No orders for this organisation yet.")}</EmptyNote>
            ) : (
              <ul className="flex flex-col divide-y divide-rule border border-rule rounded-input">
                {d.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      <b>{o.orderNumber}</b> <span className="text-muted">· {tr("{{n}} licences", { n: o.licences })} · {money(o.total, o.currency)} · {tr("order ends {{d}}", { d: day(o.validUntil) })}</span>
                    </span>
                    <StatusPill tone={o.status === "cancelled" ? "error" : ["confirmed", "allocated", "active"].includes(o.status) ? "success" : "warning"}>{ORDER_STATUS[o.status] ?? o.status}</StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <Button disabled={!canGive || !org.active} onClick={onGive}>
              {tr("Give demo licences")}
            </Button>
          </div>
        </div>
      )}
    </DetailModal>
  );
}

// The partner's Organisations page.
export function PartnerOrganisations() {
  const [me, setMe] = useState<Me | null>(null);
  const [orgs, setOrgs] = useState<PartnerOrg[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<PartnerOrg | null>(null);
  const [giving, setGiving] = useState<PartnerOrg | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const load = () => {
    setFailed(false);
    Promise.all([api<Me>("/partner/me"), api<{ organisations: PartnerOrg[] }>("/partner/organisations")])
      .then(([m, o]) => {
        setMe(m);
        setOrgs(o.organisations);
      })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);
  if (failed) return <PageError message={tr("Could not load your organisations.")} onRetry={load} />;
  if (!me || !orgs) return <PageLoading />;
  const canGive = me.demo.status === "active" && me.demo.left > 0;
  const shown = orgs.filter((o) => !q.trim() || `${o.name} ${o.admin.name} ${o.admin.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Organisations")}
        subtitle={tr("Every university, college and company you onboarded. Open one to see its admin, learners and orders.")}
        actions={
          <Button onClick={() => setAdding(true)} disabled={!canGive} className="flex items-center gap-1.5">
            <Plus size={16} /> {tr("Add an organisation")}
          </Button>
        }
      />
      {notice && (
        <Notice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}
      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-rule flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display font-bold text-lg">{orgs.length === 1 ? tr("1 organisation") : tr("{{n}} organisations", { n: orgs.length })}</h2>
          <label className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className={`${input} !pl-8 w-64`} placeholder={tr("Search by organisation or admin")} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {orgs.length === 0 ? (
          <div className="p-6">
            <EmptyNote>{tr("No organisations yet. Add a university, college or company to give them demo licences.")}</EmptyNote>
          </div>
        ) : shown.length === 0 ? (
          <div className="p-6">
            <EmptyNote>{tr("No organisation matches your search.")}</EmptyNote>
          </div>
        ) : (
          <OrganisationsTable orgs={shown} onOpen={setOpen} onGive={setGiving} canGive={canGive} />
        )}
      </div>
      {open && <OrganisationDetail org={open} canGive={canGive} onClose={() => setOpen(null)} onGive={() => { setGiving(open); setOpen(null); }} />}
      {adding && (
        <AddOrganisation
          left={me.demo.left}
          endpoint="/partner/organisations"
          windowEndsAt={me.demo.endsAt}
          onClose={() => setAdding(false)}
          onDone={(name, emailSent) => {
            setAdding(false);
            setNotice({ tone: emailSent ? "success" : "error", text: emailSent ? tr("{{name}} added. Their admin has been emailed a link to set a password.", { name }) : tr("{{name}} added, but the invitation email didn't go out. Contact Spica.", { name }) });
            load();
          }}
        />
      )}
      {giving && (
        <GiveLicences
          org={giving}
          left={me.demo.left}
          windowEndsAt={me.demo.endsAt}
          endpoint={`/partner/organisations/${giving.id}/licences`}
          onClose={() => setGiving(null)}
          onDone={(n) => {
            setNotice({ tone: "success", text: tr("{{n}} demo licences given to {{name}}.", { n, name: giving.name }) });
            setGiving(null);
            load();
          }}
        />
      )}
    </div>
  );
}
