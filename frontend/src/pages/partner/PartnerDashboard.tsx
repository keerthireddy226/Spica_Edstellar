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
import { AffiliateDashboard, reloadPartnerMe, ReferralDashboard, usePartnerMe, type PartnerMe } from "@/pages/partner/PartnerPrograms";

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
  // Not used yet and still valid; unused past their "valid until" date.
  demoLeft?: number;
  demoExpired?: number;
  demoActive: number;
  demoStarted: number;
  practiceDone: number;
  mocksDone: number;
  paidAssigned?: number;
  orders?: number;
  ordersConfirmed?: number;
  allocations?: { licences: number; validUntil: string | null; graceUntil?: string | null; givenAt: string }[];
  details?: { city: string | null; state: string | null; country: string | null; website: string | null; phone: string | null; expectedLearners: number | null; address: string | null; postalCode: string | null; gstin: string | null };
  admin: { name: string; email: string; invitePending: boolean };
}
const cardLink = "block rounded-card transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-navy";
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

// Each partner type gets its own dashboard (user, 19 Nov 2026).
export function PartnerDashboard() {
  const { me, failed, reload } = usePartnerMe();
  if (failed) return <PageError message={tr("Could not load your partner account.")} onRetry={reload} />;
  if (!me) return <PageLoading />;
  if (me.partner.type === "affiliate") return <AffiliateDashboard me={me} />;
  if (me.partner.type === "referral") return <ReferralDashboard me={me} />;
  return <OrganisationsDashboard me={me} />;
}

// Resellers and Channel Partners: organisations, demo licences and orders.
function OrganisationsDashboard({ me }: { me: PartnerMe }) {
  const [orgs, setOrgs] = useState<PartnerOrg[] | null>(null);
  const [orders, setOrders] = useState<{ status: string; validUntil: string; commissionAmount: number; currency: string; licences: number; allocatedLicences: number; assignedLearners: number }[]>([]);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [giving, setGiving] = useState<PartnerOrg | null>(null);
  const [openOrg, setOpenOrg] = useState<PartnerOrg | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const load = () => {
    setFailed(false);
    reloadPartnerMe().catch(() => {});
    api<{ organisations: PartnerOrg[] }>("/partner/organisations")
      .then((o) => setOrgs(o.organisations))
      .catch(() => setFailed(true));
    api<{ orders: { status: string; validUntil: string; commissionAmount: number; currency: string; licences: number; allocatedLicences: number; assignedLearners: number }[] }>("/partner/orders")
      .then((r) => setOrders(r.orders))
      .catch(() => setOrders([]));
  };
  useEffect(load, []);
  if (failed) return <PageError message={tr("Could not load your partner account.")} onRetry={load} />;
  if (!orgs) return <PageLoading />;
  const d = me.demo;
  // Acting needs the partnership running (not read-only); the gate already made them sign.
  const open = d.status === "active" && !me.partnership.readOnly;
  const reseller = me.partner.type === "reseller";
  const minLicences = me.minimums?.licencesPerOrg ?? 1;
  const left = me.partnership.daysLeft;
  const demoUsed = orgs.reduce((n, o) => n + o.demoUsed, 0);
  const demoStarted = orgs.reduce((n, o) => n + o.demoStarted, 0);
  const liveOrders = orders.filter((o) => o.status !== "cancelled");
  const confirmed = liveOrders.filter((o) => ["confirmed", "allocated", "active", "expired"].includes(o.status));
  const needAction = liveOrders.filter((o) => o.status === "draft" || o.status === "proforma_sent").length;
  const today = new Date().toISOString().slice(0, 10);
  const nextEnd = confirmed.map((o) => o.validUntil).filter((v) => v >= today).sort()[0] ?? null;
  const byCurrency = new Map<string, number>();
  for (const o of confirmed) byCurrency.set(o.currency, (byCurrency.get(o.currency) ?? 0) + o.commissionAmount);
  const paidOrdered = confirmed.reduce((n, o) => n + o.licences, 0);
  const paidAllocated = liveOrders.reduce((n, o) => n + o.allocatedLicences, 0);
  const paidAssigned = liveOrders.reduce((n, o) => n + o.assignedLearners, 0);
  const commission = [...byCurrency.entries()].map(([c, v]) => money(v, c)).join(" + ");
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Welcome, {{name}}", { name: me.partner.fullName })}
        subtitle={
          reseller
            ? tr("Add your customers' organisations, give them demo licences, and buy licences at your reseller price to resell at your own price.")
            : tr("Add universities, colleges and companies, give them free demo licences to try Spica, and place orders for them.")
        }
        actions={
          <Button onClick={() => setAdding(true)} disabled={!open} className="flex items-center gap-1.5">
            <Plus size={16} /> {tr("Add an organisation")}
          </Button>
        }
      />
      {notice && (
        <Notice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}
      <Notice tone="info">
        {tr("Demo licences you give an organisation are valid for {{v}} days, then {{g}} days' grace; unused ones expire after that. Each learner's demo lasts 7 days, then 3 days to see results. Give at least {{m}} licences to each organisation.", { v: d.giftValidDays, g: d.giftGraceDays, m: minLicences })}
      </Notice>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={Gift} value={d.total} label={tr("Free demo licences")} sub={tr("Your allocation from Spica")} progress={1} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={KeyRound} value={d.left} label={tr("Left to give")} sub={tr("{{n}} given so far", { n: d.given })} progress={d.total ? d.left / d.total : 0} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={UserCheck} value={demoUsed} label={tr("Used by learners")} sub={tr("of {{n}} given to organisations · {{s}} started", { n: d.given, s: demoStarted })} progress={d.given ? demoUsed / d.given : 0} />
        <StatCard variant="ledger" palette="terracotta" index={3} icon={CalendarClock} value={open ? tr("{{n}} days", { n: left ?? 0 }) : "—"} label={tr("Partnership")} sub={me.partnership.startsAt ? tr("{{a}} to {{b}}", { a: day(me.partnership.startsAt), b: day(me.partnership.endsAt) }) : tr("Not started")} progress={open && left !== null ? Math.min(1, left / 90) : 0} />
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
        {reseller ? (
          <StatCard variant="ledger" palette="terracotta" index={6} icon={Coins} value={`${me.rates.discountPercent}%`} label={tr("Your discount")} sub={tr("Off Spica's list price on every order")} progress={0} />
        ) : (
          <StatCard variant="ledger" palette="terracotta" index={6} icon={Coins} value={commission || "—"} label={tr("Commission")} sub={tr("On confirmed orders · {{n}}%", { n: me.partner.commissionPercent ?? 0 })} progress={0} />
        )}
        <StatCard variant="ledger" palette="terracotta" index={7} icon={ClipboardCheck} value={paidAssigned} label={tr("Paid licences assigned")} sub={tr("of {{a}} allocated · {{o}} on confirmed orders", { a: paidAllocated, o: paidOrdered })} progress={paidAllocated ? paidAssigned / paidAllocated : 0} />
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
        <Users size={13} /> {tr("You see learners' names and licence status only. Scores and reports stay with each organisation.")}{" "}
        <a href="/legal/privacy-channel-partners.html" target="_blank" rel="noreferrer" className="underline">
          {tr("Privacy Notice for Partners")}
        </a>
      </p>
      {adding && (
        <AddOrganisation
          left={d.left}
          endpoint="/partner/organisations"
          minLicences={minLicences}
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
          minLicences={minLicences}
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
// Demo licences given are valid 7 days, then 3 days' grace (no date to choose).
export function AddOrganisation({ left, endpoint, minLicences = 1, onClose, onDone }: { left: number; endpoint: string; minLicences?: number; onClose: () => void; onDone: (name: string, emailSent: boolean) => void }) {
  const [f, setF] = useState({ name: "", category: "university" as "university" | "company", adminFullName: "", adminEmail: "", gstin: "", demoLicences: String(Math.min(Math.max(25, minLicences), left)) });
  const [more, setMore] = useState(false);
  const [x, setX] = useState({ city: "", state: "", country: "India", address: "", postalCode: "", website: "", phone: "", expectedLearners: "", adminPhone: "" });
  const setD = (k: keyof typeof x) => (e: { target: { value: string } }) => setX({ ...x, [k]: e.target.value });
  const [dup, setDup] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (confirmDuplicate = false) => {
    setErr(null);
    const n = Math.round(Number(f.demoLicences) || 0);
    if (f.name.trim().length < 2) return setErr(tr("Enter the organisation's name."));
    if (f.adminFullName.trim().length < 2) return setErr(tr("Enter the admin's full name."));
    if (!/^\S+@\S+\.\S+$/.test(f.adminEmail.trim())) return setErr(tr("Enter a valid email address."));
    if (x.city.trim().length < 2 || x.state.trim().length < 2 || x.country.trim().length < 2) return setErr(tr("Enter the city, state and country."));
    if (n < 0 || n > left) return setErr(tr("You can give up to {{n}} licences.", { n: left }));
    if (n > 0 && n < minLicences) return setErr(tr("Give at least {{n}} licences to each organisation.", { n: minLicences }));
    setBusy(true);
    try {
      const details = Object.fromEntries(
        Object.entries(x)
          .map(([k, v]) => [k, k === "expectedLearners" ? (v.trim() ? Math.max(0, Math.round(Number(v) || 0)) : null) : v.trim() || null])
          .filter(([, v]) => v !== null),
      );
      const r = await api<{ emailSent: boolean }>(
        endpoint,
        json({ name: f.name.trim(), category: f.category, adminFullName: f.adminFullName.trim(), adminEmail: f.adminEmail.trim(), ...(f.gstin ? { gstin: f.gstin } : {}), demoLicences: n, details, confirmDuplicate }),
      );
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
            : m.includes("partnership_not_active") || m.includes("demo_window_not_open")
              ? tr("Your partnership isn't running, so you can't add organisations.")
              : m.includes("below_min_licences")
                ? tr("Give at least {{n}} licences to each organisation.", { n: minLicences })
                : m.includes("agreement_not_signed")
                  ? tr("Sign your partnership agreement first.")
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
            <span className={label}>{tr("City")}</span>
            <input className={input} value={x.city} maxLength={100} onChange={setD("city")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("State")}</span>
            <input className={input} value={x.state} maxLength={100} onChange={setD("state")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Country")}</span>
            <input className={input} value={x.country} maxLength={100} onChange={setD("country")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("GSTIN (optional)")}</span>
            <input className={input} value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") })} placeholder={tr("For Indian organisations")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Demo licences to give")}</span>
            <input className={input} type="number" min={0} max={left} value={f.demoLicences} onChange={(e) => setF({ ...f, demoLicences: e.target.value })} />
            <span className="text-xs text-muted">{tr("{{n}} left; at least {{m}}. Valid 7 days from today, then 3 days' grace. Each learner gets 7 days.", { n: left, m: minLicences })}</span>
          </label>
        </div>
        <button type="button" className="self-start text-sm font-semibold text-navy cursor-pointer" onClick={() => setMore(!more)}>
          {more ? "− " : "+ "}
          {tr("More details (optional): address, contact, expected learners")}
        </button>
        {more && (
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("Postal code")}</span>
              <input className={input} value={x.postalCode} maxLength={20} onChange={setD("postalCode")} />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={label}>{tr("Address")}</span>
              <input className={input} value={x.address} maxLength={300} onChange={setD("address")} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("Website")}</span>
              <input className={input} value={x.website} maxLength={200} placeholder="https://" onChange={setD("website")} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("Organisation phone")}</span>
              <input className={input} value={x.phone} maxLength={30} onChange={setD("phone")} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("Admin's phone")}</span>
              <input className={input} value={x.adminPhone} maxLength={30} onChange={setD("adminPhone")} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("Expected number of learners")}</span>
              <input className={input} type="number" min={0} value={x.expectedLearners} onChange={setD("expectedLearners")} />
            </label>
          </div>
        )}
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

export function GiveLicences({ org, left, endpoint, minLicences = 1, onClose, onDone }: { org: PartnerOrg; left: number; endpoint: string; minLicences?: number; onClose: () => void; onDone: (n: number) => void }) {
  const [n, setN] = useState(String(Math.min(Math.max(10, minLicences), left)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const v = Math.round(Number(n) || 0);
    if (v < minLicences || v > left) return setErr(tr("You can give between {{a}} and {{n}} licences.", { a: minLicences, n: left }));
    setBusy(true);
    try {
      await api(endpoint, json({ licences: v }));
      onDone(v);
    } catch (e) {
      const m = String((e as Error).message ?? "");
      setErr(m.includes("below_min_licences") ? tr("Give at least {{n}} licences to each organisation.", { n: minLicences }) : m.includes("partnership_not_active") ? tr("Your partnership isn't running, so you can't give licences.") : tr("Could not give the licences. Try again."));
      setBusy(false);
    }
  };
  const add = Math.max(0, Math.round(Number(n) || 0));
  const unused = org.demoLeft ?? Math.max(0, org.demoLicences - org.demoUsed);
  const tile = "border border-rule rounded-input p-3 bg-surface";
  return (
    <DetailModal title={tr("Give demo licences")} subtitle={org.name} icon={KeyRound} onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm">
        {/* Where the organisation stands now */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={tile}>
            <p className={label}>{tr("Given so far")}</p>
            <p className="text-2xl font-display font-bold">{org.demoLicences}</p>
            <p className="text-xs text-muted">{tr("demo licences")}</p>
          </div>
          <div className={tile}>
            <p className={label}>{tr("Used by learners")}</p>
            <p className="text-2xl font-display font-bold">{org.demoUsed}</p>
            <p className="text-xs text-muted">{tr("{{n}} learners started", { n: org.demoStarted })}</p>
          </div>
          <div className={tile}>
            <p className={label}>{tr("Not used yet")}</p>
            <p className="text-2xl font-display font-bold">{unused}</p>
            <p className="text-xs text-muted">{org.demoExpired ? tr("{{n}} expired unused", { n: org.demoExpired }) : tr("waiting for learners")}</p>
          </div>
          <div className={tile}>
            <p className={label}>{tr("Learners")}</p>
            <p className="text-2xl font-display font-bold">{org.learners}</p>
            <p className="text-xs text-muted">{tr("{{p}} practice tests and {{m}} mock tests finished", { p: org.practiceDone, m: org.mocksDone })}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-rule rounded-input p-3 flex flex-col gap-1">
            <p className={label}>{tr("Organisation admin")}</p>
            <p className="font-semibold">{org.admin.name || "—"}</p>
            <p className="text-muted">{org.admin.email}</p>
            <p className="text-xs text-muted">{tr("They are told by email when you give licences. Each learner they add gets a 7-day demo of English 4 Skills Essentials: Practice Modules, 2 practice tests and 1 mock test.")}</p>
          </div>
          <div className="border border-rule rounded-input p-3 flex flex-col gap-1">
            <p className={label}>{tr("Earlier gifts")}</p>
            {(org.allocations ?? []).length === 0 ? (
              <p className="text-muted">—</p>
            ) : (
              <ul className="flex flex-col gap-0.5 max-h-28 overflow-y-auto">
                {(org.allocations ?? []).map((a, i) => (
                  <li key={i} className="text-muted">
                    {a.validUntil ? tr("{{n}} given {{g}} · use by {{d}}, grace to {{e}}", { n: a.licences, g: day(a.givenAt), d: day(a.validUntil), e: day(a.graceUntil ?? a.validUntil) }) : tr("{{n}} given {{g}}", { n: a.licences, g: day(a.givenAt) })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* What to give */}
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Licences to add")}</span>
            <input className={input} type="number" min={1} max={left} value={n} onChange={(e) => setN(e.target.value)} />
            <span className="flex flex-wrap gap-2 mt-1">
              {[5, 10, 25, 50, 100].filter((q) => q <= left && q >= minLicences).map((q) => (
                <button key={q} type="button" className={`px-3 py-1 rounded-pill border text-xs font-semibold cursor-pointer ${add === q ? "bg-navy text-white border-navy" : "border-rule text-ink"}`} onClick={() => setN(String(q))}>
                  {q}
                </button>
              ))}
            </span>
            <span className="text-xs text-muted">{tr("You have {{left}} left to give; at least {{m}} at a time.", { left, m: minLicences })}</span>
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className={label}>{tr("How long they last")}</span>
            <p>{tr("Valid for 7 days from today, then 3 days' grace. Licences not given to learners by then expire.")}</p>
          </div>
        </div>

        {add > 0 && add <= left && (
          <Notice tone="info">{tr("After this, {{name}} will have {{n}} demo licences and you will have {{left}} left to give.", { name: org.name, n: org.demoLicences + add, left: left - add })}</Notice>
        )}
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
