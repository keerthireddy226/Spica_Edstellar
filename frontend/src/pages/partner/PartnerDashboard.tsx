import { useEffect, useState } from "react";
import { Building2, CalendarClock, ClipboardCheck, Coins, Gift, Handshake, KeyRound, Plus, Receipt, UserCheck, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/Button";
import { EmptyNote, Notice, PageError, PageHeader, PageLoading, StatCard } from "@/components/staff/StaffKit";
import { DetailModal } from "@/components/DetailModal";
import { tr } from "@/i18n/tr";
import { Link } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { OrganisationDetail, OrganisationsTable } from "@/pages/partner/PartnerOrganisations";
import { money } from "@/pages/partner/PartnerOrders";

// Channel Partner portal (stage 2): the partner's demo licences, the
// organisations they brought, and adding organisations / giving licences.
// Partners see names, emails and counts only — never scores or reports.
export interface PartnerOrg {
  id: string;
  name: string;
  category: string;
  createdAt: string;
  active: boolean;
  demoLicences: number;
  learners: number;
  demoUsed: number;
  demoActive: number;
  demoStarted: number;
  practiceDone: number;
  mocksDone: number;
  paidAssigned?: number;
  orders?: number;
  ordersConfirmed?: number;
  admin: { name: string; email: string; invitePending: boolean };
}
interface Me {
  partner: { id: string; fullName: string; email: string; code: string; ownLicenceEnabled: boolean; commissionPercent?: number };
  demo: { total: number; given: number; left: number; status: "not_started" | "active" | "ended"; startsAt: string | null; endsAt: string | null };
}
const cardLink = "block rounded-card transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-navy";
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

export function PartnerDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [orgs, setOrgs] = useState<PartnerOrg[] | null>(null);
  const [orders, setOrders] = useState<{ status: string; validUntil: string; commissionAmount: number; currency: string }[]>([]);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [giving, setGiving] = useState<PartnerOrg | null>(null);
  const [openOrg, setOpenOrg] = useState<PartnerOrg | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const load = () => {
    setFailed(false);
    Promise.all([api<Me>("/partner/me"), api<{ organisations: PartnerOrg[] }>("/partner/organisations")])
      .then(([m, o]) => {
        setMe(m);
        setOrgs(o.organisations);
      })
      .catch(() => setFailed(true));
    api<{ orders: { status: string; validUntil: string; commissionAmount: number; currency: string }[] }>("/partner/orders")
      .then((r) => setOrders(r.orders))
      .catch(() => setOrders([]));
  };
  useEffect(load, []);
  if (failed) return <PageError message={tr("Could not load your partner account.")} onRetry={load} />;
  if (!me || !orgs) return <PageLoading />;
  const d = me.demo;
  const open = d.status === "active";
  const left = d.endsAt ? Math.max(0, Math.ceil((new Date(d.endsAt).getTime() - Date.now()) / 86400000)) : null;
  const demoUsed = orgs.reduce((n, o) => n + o.demoUsed, 0);
  const demoStarted = orgs.reduce((n, o) => n + o.demoStarted, 0);
  const practiceDone = orgs.reduce((n, o) => n + o.practiceDone, 0);
  const mocksDone = orgs.reduce((n, o) => n + o.mocksDone, 0);
  const liveOrders = orders.filter((o) => o.status !== "cancelled");
  const confirmed = liveOrders.filter((o) => ["confirmed", "allocated", "active"].includes(o.status));
  const needAction = liveOrders.filter((o) => o.status === "draft" || o.status === "proforma_sent").length;
  const today = new Date().toISOString().slice(0, 10);
  const nextEnd = confirmed.map((o) => o.validUntil).filter((v) => v >= today).sort()[0] ?? null;
  const byCurrency = new Map<string, number>();
  for (const o of confirmed) byCurrency.set(o.currency, (byCurrency.get(o.currency) ?? 0) + o.commissionAmount);
  const commission = [...byCurrency.entries()].map(([c, v]) => money(v, c)).join(" + ");
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Welcome, {{name}}", { name: me.partner.fullName })}
        subtitle={tr("Your partner code: {{code}}. Add universities, colleges and companies, and give them free demo licences to try Spica.", { code: me.partner.code })}
        actions={
          <Button onClick={() => setAdding(true)} disabled={!open || d.left === 0} className="flex items-center gap-1.5">
            <Plus size={16} /> {tr("Add an organisation")}
          </Button>
        }
      />
      {notice && (
        <Notice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}
      {!open && (
        <Notice tone="error">
          {d.status === "not_started" ? tr("Your demo licences aren't available yet. Spica will let you know when they are.") : tr("Your demo window has ended, so no more demo licences can be given. Contact Spica to extend it.")}
        </Notice>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={Gift} value={d.total} label={tr("Free demo licences")} sub={tr("Your allocation from Spica")} progress={1} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={KeyRound} value={d.left} label={tr("Left to give")} sub={tr("{{n}} given so far", { n: d.given })} progress={d.total ? d.left / d.total : 0} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={UserCheck} value={demoUsed} label={tr("Used by learners")} sub={tr("of {{n}} given to organisations · {{s}} started", { n: d.given, s: demoStarted })} progress={d.given ? demoUsed / d.given : 0} />
        <StatCard variant="ledger" palette="terracotta" index={3} icon={CalendarClock} value={open ? tr("{{n}} days", { n: left ?? 0 }) : "—"} label={tr("Demo window")} sub={open ? tr("Until {{d}}", { d: day(d.endsAt) }) : d.status === "ended" ? tr("Ended {{d}}", { d: day(d.endsAt) }) : tr("Not started")} progress={open && left !== null ? Math.min(1, left / 90) : 0} />
        <Link to={ROUTES.PARTNER_ORGANISATIONS} aria-label={tr("See all organisations ({{n}})", { n: orgs.length })} className={cardLink}>
          <StatCard variant="ledger" palette="terracotta" index={4} icon={Building2} value={orgs.length} label={tr("Organisations")} sub={tr("{{n}} learners added", { n: orgs.reduce((n, o) => n + o.learners, 0) })} progress={0.4} />
        </Link>
        <Link to={ROUTES.PARTNER_ORDERS} aria-label={tr("Orders")} className={cardLink}>
          <StatCard
            variant="ledger"
            palette="terracotta"
            index={5}
            icon={Receipt}
            value={liveOrders.length}
            label={tr("Orders")}
            sub={needAction ? tr("{{n}} need action · see all", { n: needAction }) : nextEnd ? tr("Next order ends {{d}}", { d: day(nextEnd) }) : tr("See all orders")}
            progress={liveOrders.length ? confirmed.length / liveOrders.length : 0}
          />
        </Link>
        <StatCard variant="ledger" palette="terracotta" index={6} icon={Coins} value={commission || "—"} label={tr("Commission")} sub={tr("On confirmed orders · {{n}}%", { n: me.partner.commissionPercent ?? 0 })} progress={0} />
        <StatCard variant="ledger" palette="terracotta" index={7} icon={ClipboardCheck} value={mocksDone} label={tr("Mock tests finished")} sub={tr("{{n}} practice tests finished", { n: practiceDone })} progress={demoStarted ? Math.min(1, mocksDone / demoStarted) : 0} />
      </div>
      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-rule flex items-center gap-2">
          <Handshake size={18} className="text-navy" />
          <h2 className="font-display font-bold text-lg">{orgs.length > 5 ? tr("Latest organisations") : tr("Your organisations")}</h2>
          <Link to={ROUTES.PARTNER_ORGANISATIONS} className="ml-auto text-sm font-semibold text-navy">
            {tr("See all organisations ({{n}})", { n: orgs.length })}
          </Link>
        </div>
        {orgs.length === 0 ? (
          <div className="p-6">
            <EmptyNote>{tr("No organisations yet. Add a university, college or company to give them demo licences.")}</EmptyNote>
          </div>
        ) : (
          <OrganisationsTable orgs={orgs.slice(0, 5)} onOpen={setOpenOrg} onGive={setGiving} canGive={open && d.left > 0} />
        )}
      </div>
      <p className="text-xs text-muted flex items-center gap-1.5">
        <Users size={13} /> {tr("You see learners' names and licence status only. Scores and reports stay with each organisation.")}
      </p>
      {adding && (
        <AddOrganisation
          left={d.left}
          endpoint="/partner/organisations"
          onClose={() => setAdding(false)}
          onDone={(name, emailSent) => {
            setAdding(false);
            setNotice({ tone: emailSent ? "success" : "error", text: emailSent ? tr("{{name}} added. Their admin has been emailed a link to set a password.", { name }) : tr("{{name}} added, but the invitation email didn't go out. Contact Spica.", { name }) });
            load();
          }}
        />
      )}
      {openOrg && <OrganisationDetail org={openOrg} canGive={open && d.left > 0} onClose={() => setOpenOrg(null)} onGive={() => { setGiving(openOrg); setOpenOrg(null); }} />}
      {giving && (
        <GiveLicences
          org={giving}
          left={d.left}
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

const input = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm focus:outline-none focus:border-navy";
const label = "text-xs font-semibold text-muted uppercase tracking-wide";

// Shared with the staff console (adding an organisation for a partner).
export function AddOrganisation({ left, endpoint, onClose, onDone }: { left: number; endpoint: string; onClose: () => void; onDone: (name: string, emailSent: boolean) => void }) {
  const [f, setF] = useState({ name: "", category: "university" as "university" | "company", adminFullName: "", adminEmail: "", gstin: "", demoLicences: String(Math.min(25, left)) });
  const [dup, setDup] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (confirmDuplicate = false) => {
    setErr(null);
    const n = Math.round(Number(f.demoLicences) || 0);
    if (f.name.trim().length < 2) return setErr(tr("Enter the organisation's name."));
    if (f.adminFullName.trim().length < 2) return setErr(tr("Enter the admin's full name."));
    if (!/^\S+@\S+\.\S+$/.test(f.adminEmail.trim())) return setErr(tr("Enter a valid email address."));
    if (n < 0 || n > left) return setErr(tr("You can give up to {{n}} licences.", { n: left }));
    setBusy(true);
    try {
      const r = await api<{ emailSent: boolean }>(endpoint, json({ name: f.name.trim(), category: f.category, adminFullName: f.adminFullName.trim(), adminEmail: f.adminEmail.trim(), ...(f.gstin ? { gstin: f.gstin } : {}), demoLicences: n, confirmDuplicate }));
      onDone(f.name.trim(), r.emailSent);
    } catch (e) {
      const m = String((e as Error).message ?? "");
      if (m.includes("possible_duplicate")) {
        setDup([]);
        setBusy(false);
        return;
      }
      setErr(
        m.includes("email_already_registered")
          ? tr("This admin email already has a Spica account. Use a different email.")
          : m.includes("not_enough_licences")
            ? tr("You don't have that many licences left.")
            : m.includes("demo_window_not_open")
              ? tr("Your demo window isn't open.")
              : tr("Could not add the organisation. Try again."),
      );
      setBusy(false);
    }
  };
  return (
    <DetailModal title={tr("Add an organisation")} subtitle={tr("A university, college or company. Its admin gets an email to set a password and add learners.")} icon={Building2} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Organisation name")}</span>
            <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tr("e.g. City College of Commerce")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Type")}</span>
            <select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as "university" | "company" })}>
              <option value="university">{tr("University or college")}</option>
              <option value="company">{tr("Company")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Admin's full name")}</span>
            <input className={input} value={f.adminFullName} onChange={(e) => setF({ ...f, adminFullName: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Admin's email")}</span>
            <input className={input} type="email" value={f.adminEmail} onChange={(e) => { setDup(null); setF({ ...f, adminEmail: e.target.value }); }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("GSTIN (optional)")}</span>
            <input className={input} value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") })} placeholder={tr("For Indian organisations")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Demo licences to give")}</span>
            <input className={input} type="number" min={0} max={left} value={f.demoLicences} onChange={(e) => setF({ ...f, demoLicences: e.target.value })} />
            <span className="text-xs text-muted">{tr("{{n}} left. Each learner gets 7 days from when the licence is assigned.", { n: left })}</span>
          </label>
        </div>
        {dup && (
          <Notice tone="error">
            {tr("Another Spica customer already uses this email domain. Check it isn't the same organisation before adding it.")}
            <div className="mt-2">
              <Button disabled={busy} onClick={() => submit(true)}>
                {tr("It's a different organisation, add it")}
              </Button>
            </div>
          </Notice>
        )}
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={() => submit(false)} disabled={busy}>
            {busy ? tr("Adding…") : tr("Add organisation")}
          </Button>
        </div>
      </div>
    </DetailModal>
  );
}

export function GiveLicences({ org, left, endpoint, onClose, onDone }: { org: PartnerOrg; left: number; endpoint: string; onClose: () => void; onDone: (n: number) => void }) {
  const [n, setN] = useState(String(Math.min(10, left)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const v = Math.round(Number(n) || 0);
    if (v < 1 || v > left) return setErr(tr("You can give between 1 and {{n}} licences.", { n: left }));
    setBusy(true);
    try {
      await api(endpoint, json({ licences: v }));
      onDone(v);
    } catch {
      setErr(tr("Could not give the licences. Try again."));
      setBusy(false);
    }
  };
  return (
    <DetailModal title={tr("Give demo licences")} subtitle={org.name} icon={KeyRound} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">{tr("{{name}} has {{n}} demo licences now. You have {{left}} left to give.", { name: org.name, n: org.demoLicences, left })}</p>
        <label className="flex flex-col gap-1 max-w-xs">
          <span className={label}>{tr("Licences to add")}</span>
          <input className={input} type="number" min={1} max={left} value={n} onChange={(e) => setN(e.target.value)} />
        </label>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? tr("Giving…") : tr("Give licences")}
          </Button>
        </div>
      </div>
    </DetailModal>
  );
}
