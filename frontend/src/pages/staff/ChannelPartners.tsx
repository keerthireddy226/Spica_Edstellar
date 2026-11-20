import { useEffect, useMemo, useState } from "react";
import { OrdersPanel } from "@/pages/partner/PartnerOrders";
import { MinimumCell } from "@/pages/partner/PartnerOrganisations";
import { CalendarClock, Gift, Handshake, KeyRound, Mail, Plus, Power, Building2, History, Receipt, FileSignature, Coins, Megaphone } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyNote, Notice, PageError, PageHeader, PageLoading, SearchBox, StatCard, StatusPill } from "@/components/staff/StaffKit";
import { Badge, DetailModal, InfoGrid, ModalEmpty, ModalSection } from "@/components/DetailModal";
import {
  bringsOrganisations,
  createChannelPartner,
  deactivatePartner,
  getChannelPartner,
  listChannelPartners,
  markEarningPaid,
  partnerEarnings,
  partnerLeads,
  PARTNER_TYPES,
  reactivatePartner,
  renewPartnership,
  resendPartnerInvite,
  startPartnership,
  terminatePartnership,
  updateChannelPartner,
  updatePartnerLead,
  voidEarning,
  type ChannelPartner,
  type ChannelPartnerDetail,
  type EarningsResponse,
  type PartnerLead,
  type PartnerType,
  type PartnershipLength,
} from "@/api/channelPartners";
import { fmtDay, leadStatusLabel, minorMoney, PartnershipPill, typeBlurb, typeLabel } from "@/components/partner/partnerUi";
import { tr } from "@/i18n/tr";
import { api } from "@/lib/api";
import { AddOrganisation, GiveLicences, type PartnerOrg } from "@/pages/partner/PartnerDashboard";
import { appLocale } from "@/lib/locale";

// A Reseller's discount is at most 50% (owner, 20 Nov 2026): the box never holds more.
const MAX_DISCOUNT = 50;
const capDiscount = (v: string) => (Number(v) > MAX_DISCOUNT ? String(MAX_DISCOUNT) : Number(v) < 0 ? "0" : v);

// Partnership length (owner, 20 Nov 2026): Spica picks it per partner,
// 1, 3, 6 or 12 months, or a chosen end date; 3 months by default.
type LengthValue = { months: string; endsOn: string };
const lengthBody = (v: LengthValue): PartnershipLength => (v.months === "custom" ? (v.endsOn ? { endsOn: v.endsOn } : {}) : { months: Number(v.months) });
function LengthPicker({ value, onChange }: { value: LengthValue; onChange: (v: LengthValue) => void }) {
  const field = "rounded-input border border-rule bg-surface px-3 py-2 text-sm";
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-semibold text-muted uppercase tracking-wide">{tr("Partnership length")}</span>
      <select className={field} value={value.months} onChange={(e) => onChange({ ...value, months: e.target.value })}>
        <option value="1">{tr("1 month")}</option>
        <option value="3">{tr("3 months")}</option>
        <option value="6">{tr("6 months")}</option>
        <option value="12">{tr("12 months")}</option>
        <option value="custom">{tr("Choose an end date")}</option>
      </select>
      {value.months === "custom" && <input className={field} type="date" min={tomorrow} value={value.endsOn} onChange={(e) => onChange({ ...value, endsOn: e.target.value })} />}
    </label>
  );
}


// Partners (19 Nov 2026): Resellers, Channel Partners, Affiliates and Referral
// Partners. Spica registers them (they can't sign themselves up), fixes their
// minimums and rates, and runs the 3-month partnership: start, renew (blocked
// below the organisation minimum unless a reason is given) and terminate.
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" }) : "—");
const rateText = (p: ChannelPartner) =>
  p.partnerType === "reseller"
    ? tr("{{n}}% discount", { n: p.discountPercent })
    : p.partnerType === "referral"
      ? tr("{{fee}} per referral", { fee: minorMoney(p.referralFee, p.referralFeeCurrency) })
      : tr("{{n}}% commission", { n: p.commissionPercent });

const actionLabel = (a: string) =>
  ({
    "channel_partner.created": tr("Partner registered"),
    "channel_partner.updated": tr("Details changed"),
    "channel_partner.own_licence_on": tr("Own demo licence switched on"),
    "channel_partner.own_licence_off": tr("Own demo licence switched off"),
    "channel_partner.demo_started": tr("Partnership started"),
    "channel_partner.demo_extended": tr("Partnership end changed"),
    "channel_partner.demo_ended": tr("Partnership ended"),
    "channel_partner.renewed": tr("Partnership renewed"),
    "channel_partner.terminated": tr("Partnership terminated"),
    "channel_partner.agreement_signed": tr("Agreement signed"),
    "channel_partner.lead_submitted": tr("Referral submitted"),
    "channel_partner.lead_updated": tr("Referral updated"),
    "channel_partner.earning_paid": tr("Earning paid"),
    "channel_partner.earning_voided": tr("Earning cancelled"),
    "channel_partner.deactivated": tr("Partner deactivated"),
    "channel_partner.reactivated": tr("Partner reactivated"),
    "channel_partner.invite_resent": tr("Invitation sent again"),
    "channel_partner.organisation_added": tr("Organisation added"),
    "channel_partner.licences_given": tr("Demo licences given"),
  })[a] ?? a;

export function ChannelPartners() {
  const [rows, setRows] = useState<ChannelPartner[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<PartnerType | "all">("all");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const load = () => {
    setFailed(false);
    listChannelPartners()
      .then((r) => setRows(r.partners))
      .catch(() => setFailed(true));
  };
  useEffect(load, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((p) => (typeFilter === "all" || p.partnerType === typeFilter) && (!s || `${p.fullName} ${p.email} ${p.code}`.toLowerCase().includes(s)));
  }, [rows, q, typeFilter]);
  if (failed) return <PageError message={tr("Could not load partners.")} onRetry={load} />;
  if (!rows) return <PageLoading />;
  const active = rows.filter((p) => p.active);
  const totalDemo = active.reduce((n, p) => n + p.demoLicences, 0);
  const running = active.filter((p) => p.status === "active" || p.status === "expiring").length;
  const unsigned = active.filter((p) => (p.status === "active" || p.status === "expiring") && !p.agreement).length;
  const orgs = rows.reduce((n, p) => n + p.organisations, 0);

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Partners")}
        subtitle={tr("Resellers, Channel Partners, Affiliates and Referral Partners. Register a partner, fix their minimums and rates, and run their partnership.")}
        actions={
          <Button onClick={() => setCreating(true)} className="flex items-center gap-1.5">
            <Plus size={16} /> {tr("Register a partner")}
          </Button>
        }
      />
      {notice && (
        <Notice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={Handshake} value={active.length} label={tr("Active partners")} sub={tr("{{n}} registered in total", { n: rows.length })} progress={rows.length ? active.length / rows.length : 0} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={Gift} value={totalDemo} label={tr("Free demo licences")} sub={tr("Across active partners")} progress={0.5} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={CalendarClock} value={running} label={tr("Partnerships running")} sub={unsigned ? tr("{{n}} not signed yet", { n: unsigned }) : tr("All agreements signed")} progress={active.length ? running / active.length : 0} />
        <StatCard variant="ledger" palette="terracotta" index={3} icon={Building2} value={orgs} label={tr("Organisations brought")} sub={tr("By all partners")} progress={0.3} />
      </div>

      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-rule flex flex-wrap gap-3 items-center">
          <SearchBox value={q} onChange={setQ} placeholder={tr("Search by name, email or code")} />
          <div className="flex flex-wrap gap-1.5">
            {(["all", ...PARTNER_TYPES] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`rounded-full px-3 py-1 text-xs font-semibold border cursor-pointer ${typeFilter === t ? "bg-navy text-white border-navy" : "border-rule text-muted hover:text-ink"}`}
              >
                {t === "all" ? tr("All types") : typeLabel(t)} ({t === "all" ? rows.length : rows.filter((p) => p.partnerType === t).length})
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="p-6">
            <EmptyNote>{rows.length ? tr("No partner matches your search.") : tr("No partners yet. Register the first one.")}</EmptyNote>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide">
                <tr>
                  {[tr("Partner"), tr("Type"), tr("Code"), tr("Partnership"), tr("Agreement"), tr("Rate"), tr("Organisations"), tr("Account")].map((h) => (
                    <th key={h} className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} onClick={() => setOpenId(p.id)} className="border-t border-rule hover:bg-paper-warm/60 cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{p.fullName}</p>
                      <p className="text-xs text-muted">{p.email}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{typeLabel(p.partnerType)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                    <td className="px-4 py-3">
                      <PartnershipPill status={p.status} endsAt={p.endsAt} />
                      {p.startsAt && <p className="text-xs text-muted mt-1 whitespace-nowrap">{`${fmtDay(p.startsAt)} – ${fmtDay(p.endsAt)}`}</p>}
                    </td>
                    <td className="px-4 py-3">{p.agreement ? <StatusPill tone="success">{tr("Signed {{d}}", { d: fmtDay(p.agreement.signedAt) })}</StatusPill> : <StatusPill tone="warning">{tr("Not signed")}</StatusPill>}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{rateText(p)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {bringsOrganisations(p.partnerType) ? (
                        <span className={p.activeOrganisations < p.minOrganisations ? "text-error font-semibold" : ""}>{tr("{{n}} of {{min}}", { n: p.activeOrganisations, min: p.minOrganisations })}</span>
                      ) : p.partnerType === "referral" ? (
                        tr("{{n}} referrals", { n: p.leads })
                      ) : (
                        tr("{{n}} sign-ups", { n: p.referredPeople })
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!p.active ? <StatusPill tone="error">{tr("Deactivated")}</StatusPill> : p.invitePending ? <StatusPill tone="warning">{tr("Invite pending")}</StatusPill> : <StatusPill tone="success">{tr("Active")}</StatusPill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <CreatePartner
          onClose={() => setCreating(false)}
          onCreated={(code, emailSent) => {
            setCreating(false);
            setNotice({ tone: emailSent ? "success" : "error", text: emailSent ? tr("Partner registered with code {{code}}. They've been emailed a link to set their password.", { code }) : tr("Partner registered with code {{code}}, but the invitation email didn't go out. Open the partner and send it again.", { code }) });
            load();
          }}
        />
      )}
      {openId && <PartnerDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

const input = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm focus:outline-none focus:border-navy";
const label = "text-xs font-semibold text-muted uppercase tracking-wide";

function CreatePartner({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string, emailSent: boolean) => void }) {
  const [f, setF] = useState({
    partnerType: "channel_partner" as PartnerType,
    fullName: "",
    email: "",
    commissionPercent: "0",
    demoLicences: "250",
    startDemoNow: true,
    ownLicenceEnabled: false,
    notes: "",
    minOrganisations: "10",
    minLicencesPerOrg: "1",
    discountPercent: "0",
    referralFee: "0",
    referralFeeCurrency: "USD" as "INR" | "USD",
    length: { months: "3", endsOn: "" } as LengthValue,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const t = f.partnerType;
  const orgType = bringsOrganisations(t);
  const submit = async () => {
    setErr(null);
    if (f.fullName.trim().length < 2) return setErr(tr("Enter the partner's full name."));
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr(tr("Enter a valid email address."));
    setBusy(true);
    try {
      const r = await createChannelPartner({
        partnerType: t,
        fullName: f.fullName.trim(),
        email: f.email.trim(),
        commissionPercent: Number(f.commissionPercent) || 0,
        demoLicences: orgType ? Math.max(0, Math.round(Number(f.demoLicences) || 0)) : 0,
        startDemoNow: f.startDemoNow,
        ...lengthBody(f.length),
        ownLicenceEnabled: orgType && f.ownLicenceEnabled,
        notes: f.notes.trim() || undefined,
        minOrganisations: Math.max(0, Math.round(Number(f.minOrganisations) || 0)),
        minLicencesPerOrg: Math.max(1, Math.round(Number(f.minLicencesPerOrg) || 1)),
        discountPercent: Math.min(MAX_DISCOUNT, Math.max(0, Number(f.discountPercent) || 0)),
        referralFee: Math.max(0, Math.round((Number(f.referralFee) || 0) * 100)),
        referralFeeCurrency: f.referralFeeCurrency,
      });
      onCreated(r.code, r.emailSent);
    } catch (e) {
      const m = String((e as Error).message ?? "");
      setErr(m.includes("email_already_registered") ? tr("This email already has a Spica account. Use a different email.") : tr("Could not register the partner. Try again."));
      setBusy(false);
    }
  };
  return (
    <DetailModal title={tr("Register a partner")} subtitle={tr("The partner gets an email to set their password and signs the partnership agreement at first sign-in. Spica creates their unique code.")} icon={Handshake} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className={label}>{tr("Partner type")}</span>
          <div className="grid sm:grid-cols-2 gap-2">
            {PARTNER_TYPES.map((x) => (
              <label key={x} className={`flex items-start gap-2.5 rounded-input border p-3 cursor-pointer ${t === x ? "border-navy bg-navy/5" : "border-rule"}`}>
                <input type="radio" name="ptype" className="mt-1 accent-navy" checked={t === x} onChange={() => setF({ ...f, partnerType: x })} />
                <span className="text-sm">
                  <b>{typeLabel(x)}</b>
                  <br />
                  <span className="text-muted">{typeBlurb(x)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Full name")}</span>
            <input className={input} value={f.fullName} onChange={set("fullName")} placeholder={tr("e.g. Priya Sharma")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Email")}</span>
            <input className={input} type="email" value={f.email} onChange={set("email")} placeholder="name@company.com" />
          </label>
          {orgType && (
            <>
              <label className="flex flex-col gap-1">
                <span className={label}>{tr("Minimum organisations")}</span>
                <input className={input} type="number" min={0} value={f.minOrganisations} onChange={set("minOrganisations")} />
                <span className="text-xs text-muted">{tr("To onboard in each partnership period. Renewal is blocked below it unless you give a reason.")}</span>
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>{tr("Minimum licences per organisation")}</span>
                <input className={input} type="number" min={1} value={f.minLicencesPerOrg} onChange={set("minLicencesPerOrg")} />
                <span className="text-xs text-muted">{tr("The total each organisation should reach (demo and paid together), in any amounts. Only organisations at this total count towards the minimum.")}</span>
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>{tr("Free demo licences")}</span>
                <input className={input} type="number" min={0} value={f.demoLicences} onChange={set("demoLicences")} />
              </label>
            </>
          )}
          {(t === "channel_partner" || t === "affiliate") && (
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("Commission (%)")}</span>
              <input className={input} type="number" min={0} max={100} step="0.5" value={f.commissionPercent} onChange={set("commissionPercent")} />
              <span className="text-xs text-muted">{t === "affiliate" ? tr("Of each paid purchase (before tax) made through their link or code.") : tr("Of each confirmed paid order (before tax). Leave at 0 until decided.")}</span>
            </label>
          )}
          {t === "reseller" && (
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("Reseller discount (%)")}</span>
              <input className={input} type="number" min={0} max={MAX_DISCOUNT} step="0.5" value={f.discountPercent} onChange={(e) => setF({ ...f, discountPercent: capDiscount(e.target.value) })} />
              <span className="text-xs text-muted">{tr("Up to 50% off Spica's list price. The reseller sets its own selling price.")}</span>
            </label>
          )}
          {t === "referral" && (
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("Referral fee")}</span>
              <span className="flex gap-2">
                <span className="self-center text-sm font-semibold text-ink">USD</span>
                <input className={input} type="number" min={0} step="1" value={f.referralFee} onChange={set("referralFee")} />
              </span>
              <span className="text-xs text-muted">{tr("Paid once per referred organisation, at its first paid purchase.")}</span>
            </label>
          )}
        </div>
        <label className="flex items-start gap-2.5 rounded-input border border-rule p-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-navy" checked={f.startDemoNow} onChange={set("startDemoNow")} />
          <span className="text-sm">
            <b>{tr("Start the partnership today")}</b>
            <br />
            <span className="text-muted">{tr("It runs from today for the length you choose. You can renew it later.")}</span>
          </span>
        </label>
        <LengthPicker value={f.length} onChange={(length) => setF({ ...f, length })} />
        {orgType && (
          <label className="flex items-start gap-2.5 rounded-input border border-rule p-3 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-navy" checked={f.ownLicenceEnabled} onChange={set("ownLicenceEnabled")} />
            <span className="text-sm">
              <b>{tr("Give the partner one demo licence of their own")}</b>
              <br />
              <span className="text-muted">{tr("For showing Spica in meetings. Separate from the free demo licences. No certificate.")}</span>
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("Notes (only Spica staff see these)")}</span>
          <textarea className={input} rows={2} value={f.notes} onChange={set("notes")} />
        </label>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? tr("Registering…") : tr("Register partner")}
          </Button>
        </div>
      </div>
    </DetailModal>
  );
}

function PartnerDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<ChannelPartnerDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState("overview");
  // A normal popup (not the browser's) to confirm ending the window or deactivating.
  const [ask, setAsk] = useState<{ text: string; label: string; go: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [edit, setEdit] = useState<{ fullName: string; demoLicences: string; commissionPercent: string; notes: string; minOrganisations: string; minLicencesPerOrg: string; discountPercent: string; referralFee: string } | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [len, setLen] = useState<LengthValue>({ months: "", endsOn: "" });
  const [reason, setReason] = useState("");
  const [terminating, setTerminating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [giving, setGiving] = useState<PartnerOrg | null>(null);
  const load = () =>
    getChannelPartner(id)
      .then((r) => setD(r))
      .catch(() => setFailed(true));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      await load();
      onChanged();
    } catch (e) {
      const m = String((e as Error).message ?? "");
      setMsg({
        tone: "error",
        text: m.includes("minimum_not_met")
          ? tr("Below the organisation minimum: give a reason of at least 10 characters to renew anyway.")
          : m.includes("partnership_terminated")
            ? tr("This partnership was terminated and can't be renewed.")
            : tr("That didn't work. Try again."),
      });
    } finally {
      setBusy(false);
    }
  };
  if (failed) return <DetailModal title={tr("Partner")} onClose={onClose}><ModalEmpty>{tr("Could not load this partner.")}</ModalEmpty></DetailModal>;
  if (!d) return <DetailModal title={tr("Partner")} onClose={onClose}><ModalEmpty>{tr("Loading…")}</ModalEmpty></DetailModal>;
  const p = d.partner;
  // The picker starts at this partner's usual length.
  const lenValue: LengthValue = len.months ? len : { months: String(p.partnershipMonths ?? 3), endsOn: "" };
  const orgType = bringsOrganisations(p.partnerType);
  const running = p.status === "active" || p.status === "expiring";
  const belowMin = orgType && p.activeOrganisations < p.minOrganisations;
  const initials = p.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <DetailModal
      title={p.fullName}
      subtitle={`${typeLabel(p.partnerType)} · ${p.email} · ${p.code}`}
      initials={initials}
      onClose={onClose}
      badges={
        <>
          <Badge tone={p.status === "active" ? "good" : p.status === "expiring" ? "warn" : p.status === "not_started" ? "neutral" : "bad"}>{typeLabel(p.partnerType)}</Badge>
          <Badge tone={p.agreement ? "good" : "warn"}>{p.agreement ? tr("Agreement signed") : tr("Agreement not signed")}</Badge>
          <Badge tone={!p.active ? "bad" : p.invitePending ? "warn" : "good"}>{!p.active ? tr("Deactivated") : p.invitePending ? tr("Invite pending") : tr("Active")}</Badge>
        </>
      }
      stats={[
        { label: tr("Partnership"), value: p.status === "not_started" ? tr("Not started") : fmtDay(p.endsAt), hint: p.status === "expired" || p.status === "terminated" ? tr("Ended · read-only") : tr("Ends") },
        ...(orgType
          ? [
              { label: tr("Organisations"), value: tr("{{n}} of {{min}}", { n: p.activeOrganisations, min: p.minOrganisations }), hint: (belowMin ? tr("Below minimum") : tr("Minimum met")) + ` · ${tr("{{k}} added; counted at {{m}} licences", { k: p.addedOrganisations ?? p.activeOrganisations, m: p.minLicencesPerOrg })}` },
              { label: tr("Demo licences"), value: tr("{{given}} of {{total}}", { given: p.demoLicencesGiven, total: p.demoLicences }), hint: tr("Given out") },
              { label: tr("Learners on a demo"), value: d.organisations.reduce((n, o) => n + o.demoUsed, 0), hint: tr("{{n}} started a test", { n: d.organisations.reduce((n, o) => n + o.demoStarted, 0) }) },
            ]
          : p.partnerType === "referral"
            ? [{ label: tr("Referrals"), value: p.leads }]
            : [{ label: tr("Sign-ups with their code"), value: p.referredPeople }]),
        { label: tr("Rate"), value: rateText(p) },
      ]}
      tabs={[
        { key: "overview", label: tr("Overview") },
        ...(orgType
          ? [
              { key: "orgs", label: tr("Organisations"), count: d.organisations.length },
              { key: "orders", label: tr("Orders") },
            ]
          : []),
        ...(p.partnerType === "referral" ? [{ key: "leads", label: tr("Referrals"), count: p.leads }] : []),
        ...(p.partnerType === "affiliate" ? [{ key: "people", label: tr("People credited"), count: p.referredPeople }] : []),
        ...(p.partnerType === "referral" || p.partnerType === "affiliate" ? [{ key: "earnings", label: tr("Earnings") }] : []),
        { key: "agreement", label: tr("Agreement and renewals"), count: d.agreements.length },
        { key: "history", label: tr("History"), count: d.history.length },
      ]}
      tab={tab}
      onTab={setTab}
    >
      <div className="flex flex-col gap-5">
        {msg && (
          <Notice tone={msg.tone} onClose={() => setMsg(null)}>
            {msg.text}
          </Notice>
        )}
        {tab === "overview" && (
          <>
            <ModalSection
              title={tr("Partner details")}
              icon={Handshake}
              action={
                !edit && (
                  <button
                    className="text-sm font-semibold text-navy cursor-pointer"
                    onClick={() =>
                      setEdit({
                        fullName: p.fullName,
                        demoLicences: String(p.demoLicences),
                        commissionPercent: String(p.commissionPercent),
                        notes: p.notes ?? "",
                        minOrganisations: String(p.minOrganisations),
                        minLicencesPerOrg: String(p.minLicencesPerOrg),
                        discountPercent: String(p.discountPercent),
                        referralFee: String(p.referralFee / 100),
                      })
                    }
                  >
                    {tr("Edit")}
                  </button>
                )
              }
            >
              {edit ? (
                <div className="flex flex-col gap-3">
                  <div className="grid sm:grid-cols-3 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className={label}>{tr("Full name")}</span>
                      <input className={input} value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} />
                    </label>
                    {orgType && (
                      <>
                        <label className="flex flex-col gap-1">
                          <span className={label}>{tr("Free demo licences")}</span>
                          <input className={input} type="number" min={0} value={edit.demoLicences} onChange={(e) => setEdit({ ...edit, demoLicences: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className={label}>{tr("Minimum organisations")}</span>
                          <input className={input} type="number" min={0} value={edit.minOrganisations} onChange={(e) => setEdit({ ...edit, minOrganisations: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className={label}>{tr("Minimum licences per organisation")}</span>
                          <input className={input} type="number" min={1} value={edit.minLicencesPerOrg} onChange={(e) => setEdit({ ...edit, minLicencesPerOrg: e.target.value })} />
                        </label>
                      </>
                    )}
                    {(p.partnerType === "channel_partner" || p.partnerType === "affiliate") && (
                      <label className="flex flex-col gap-1">
                        <span className={label}>{tr("Commission (%)")}</span>
                        <input className={input} type="number" min={0} max={100} step="0.5" value={edit.commissionPercent} onChange={(e) => setEdit({ ...edit, commissionPercent: e.target.value })} />
                      </label>
                    )}
                    {p.partnerType === "reseller" && (
                      <label className="flex flex-col gap-1">
                        <span className={label}>{tr("Reseller discount (%)")}</span>
                        <input className={input} type="number" min={0} max={MAX_DISCOUNT} step="0.5" value={edit.discountPercent} onChange={(e) => setEdit({ ...edit, discountPercent: capDiscount(e.target.value) })} />
                        <span className="text-xs text-muted">{tr("Up to 50% off Spica's list price. The reseller sets its own selling price.")}</span>
                      </label>
                    )}
                    {p.partnerType === "referral" && (
                      <label className="flex flex-col gap-1">
                        <span className={label}>{tr("Referral fee ({{c}})", { c: p.referralFeeCurrency })}</span>
                        <input className={input} type="number" min={0} value={edit.referralFee} onChange={(e) => setEdit({ ...edit, referralFee: e.target.value })} />
                      </label>
                    )}
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className={label}>{tr("Notes (only Spica staff see these)")}</span>
                    <textarea className={input} rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
                  </label>
                  <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={() => setEdit(null)}>
                      {tr("Cancel")}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await updateChannelPartner(p.id, {
                            fullName: edit.fullName.trim(),
                            notes: edit.notes.trim() || null,
                            ...(orgType
                              ? { demoLicences: Math.max(0, Math.round(Number(edit.demoLicences) || 0)), minOrganisations: Math.max(0, Math.round(Number(edit.minOrganisations) || 0)), minLicencesPerOrg: Math.max(1, Math.round(Number(edit.minLicencesPerOrg) || 1)) }
                              : {}),
                            ...(p.partnerType === "channel_partner" || p.partnerType === "affiliate" ? { commissionPercent: Number(edit.commissionPercent) || 0 } : {}),
                            ...(p.partnerType === "reseller" ? { discountPercent: Math.min(MAX_DISCOUNT, Math.max(0, Number(edit.discountPercent) || 0)) } : {}),
                            ...(p.partnerType === "referral" ? { referralFee: Math.max(0, Math.round((Number(edit.referralFee) || 0) * 100)) } : {}),
                          });
                          setEdit(null);
                        }, tr("Saved."))
                      }
                    >
                      {tr("Save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <InfoGrid
                  columns={3}
                  items={[
                    [tr("Partner type"), typeLabel(p.partnerType)],
                    [tr("Partner code"), <span className="font-mono">{p.code}</span>],
                    [tr("Email"), p.email],
                    [tr("Rate"), rateText(p)],
                    ...(orgType
                      ? ([
                          [tr("Minimum organisations"), p.minOrganisations],
                          [tr("Minimum licences per organisation"), p.minLicencesPerOrg],
                          [tr("Free demo licences"), p.demoLicences],
                        ] as [string, React.ReactNode][])
                      : []),
                    [tr("Registered"), `${day(p.createdAt)}${p.createdBy ? ` · ${p.createdBy}` : ""}`],
                    [tr("Last sign-in"), p.lastSignIn ? day(p.lastSignIn) : tr("Not yet")],
                    [tr("Notes"), p.notes || "—"],
                  ]}
                />
              )}
            </ModalSection>

            {p.partnerType === "channel_partner" && (
              <ModalSection title={tr("Payout details")} icon={Coins}>
                <PayoutDetailsBox partnerId={p.id} />
              </ModalSection>
            )}
            <ModalSection title={tr("Partnership")} icon={CalendarClock}>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <PartnershipPill status={p.status} endsAt={p.endsAt} />
                {p.startsAt && <span>{tr("{{a}} to {{b}}", { a: fmtDay(p.startsAt), b: fmtDay(p.endsAt) })}</span>}
                {p.agreement ? (
                  <StatusPill tone="success">{tr("Agreement signed by {{n}} on {{d}}", { n: p.agreement.signedName, d: fmtDay(p.agreement.signedAt) })}</StatusPill>
                ) : (
                  <StatusPill tone="warning">{tr("Agreement for this period not signed: the partner can't act yet")}</StatusPill>
                )}
              </div>
              <p className="text-sm text-muted">
                {p.status === "not_started"
                  ? tr("Not started. Starting it runs the partnership from today for the length you choose.")
                  : p.status === "terminated"
                    ? tr("Terminated on {{d}}. Reason: {{r}}. The partner's portal is read-only.", { d: fmtDay(p.terminatedAt), r: p.terminationReason ?? "—" })
                    : p.status === "expired"
                      ? tr("Ended on {{d}}. The partner's portal is read-only until you renew.", { d: fmtDay(p.endsAt) })
                      : orgType
                        ? tr("Renewing extends it by the length you choose. It needs {{min}} organisations; this partner has {{n}}.", { min: p.minOrganisations, n: p.activeOrganisations })
                        : tr("Renewing extends it by the length you choose. The partner signs the agreement again for the new period.")}
              </p>
              {(p.status === "not_started" || running || p.status === "expired") && <LengthPicker value={lenValue} onChange={setLen} />}
              <div className="flex flex-wrap items-start gap-2">
                {p.status === "not_started" && (
                  <Button disabled={busy || !p.active} onClick={() => run(() => startPartnership(p.id, lengthBody(lenValue)), tr("Partnership started."))}>
                    {tr("Start the partnership")}
                  </Button>
                )}
                {(running || p.status === "expired") && !renewing && (
                  <Button disabled={busy || !p.active} onClick={() => (belowMin ? setRenewing(true) : run(() => renewPartnership(p.id, undefined, lengthBody(lenValue)), tr("Renewed. The partner must sign the agreement again.")))}>
                    {tr("Renew")}
                  </Button>
                )}
                {(running || p.status === "expired") && !terminating && (
                  <Button variant="secondary" disabled={busy} onClick={() => setTerminating(true)}>
                    {tr("Terminate")}
                  </Button>
                )}
              </div>
              {renewing && (
                <div className="flex flex-col gap-2 rounded-input border border-warning/50 bg-warning/10 p-3">
                  <p className="text-sm">{tr("This partner has {{n}} of {{min}} organisations. To renew anyway, write why. The reason is recorded.", { n: p.activeOrganisations, min: p.minOrganisations })}</p>
                  <textarea className={input} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={() => setRenewing(false)}>
                      {tr("Cancel")}
                    </Button>
                    <Button
                      disabled={busy || reason.trim().length < 10}
                      onClick={() =>
                        run(async () => {
                          await renewPartnership(p.id, reason.trim(), lengthBody(lenValue));
                          setRenewing(false);
                          setReason("");
                        }, tr("Renewed with your reason recorded. The partner must sign the agreement again."))
                      }
                    >
                      {tr("Renew below minimum")}
                    </Button>
                  </div>
                </div>
              )}
              {terminating && (
                <div className="flex flex-col gap-2 rounded-input border border-error/40 bg-error/5 p-3">
                  <p className="text-sm">{tr("Terminating ends the partnership now. The partner's portal becomes read-only and they are emailed the reason. Organisations and learners keep what they have.")}</p>
                  <textarea className={input} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("Reason (sent to the partner)")} />
                  <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={() => setTerminating(false)}>
                      {tr("Cancel")}
                    </Button>
                    <Button
                      disabled={busy || reason.trim().length < 5}
                      onClick={() =>
                        run(async () => {
                          await terminatePartnership(p.id, reason.trim());
                          setTerminating(false);
                          setReason("");
                        }, tr("Partnership terminated."))
                      }
                    >
                      {tr("Terminate partnership")}
                    </Button>
                  </div>
                </div>
              )}
            </ModalSection>

            {orgType && <ModalSection title={tr("Partner's own demo licence")} icon={KeyRound}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-navy" checked={p.ownLicenceEnabled} disabled={busy} onChange={(e) => run(() => updateChannelPartner(p.id, { ownLicenceEnabled: e.target.checked }), e.target.checked ? tr("Own demo licence switched on.") : tr("Own demo licence switched off."))} />
                <span className="text-sm">
                  {tr("One demo licence for the partner to show Spica in meetings. Separate from the free demo licences; no certificate (a sample certificate is shown).")}
                </span>
              </label>
            </ModalSection>}

            <ModalSection title={tr("Account")} icon={Power}>
              <div className="flex flex-wrap gap-2">
                {p.active && (
                  <Button variant="secondary" disabled={busy} onClick={() => run(() => resendPartnerInvite(p.id), tr("Invitation sent again."))} className="flex items-center gap-1.5">
                    <Mail size={15} /> {p.invitePending ? tr("Send the invitation again") : tr("Send a set-password link")}
                  </Button>
                )}
                {p.active ? (
                  <Button variant="secondary" disabled={busy} onClick={() => setAsk({ text: tr("Deactivate this partner? They're signed out and can't sign in. Their organisations stay."), label: tr("Deactivate partner"), go: () => run(() => deactivatePartner(p.id), tr("Partner deactivated.")) })}>
                    {tr("Deactivate partner")}
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={() => run(() => reactivatePartner(p.id), tr("Partner reactivated."))}>
                    {tr("Reactivate partner")}
                  </Button>
                )}
              </div>
            </ModalSection>
          </>
        )}
        {ask && (
          <DetailModal title={tr("Are you sure?")} subtitle={p.fullName} icon={Handshake} onClose={() => setAsk(null)}>
            <div className="flex flex-col gap-4 text-sm">
              <p>{ask.text}</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setAsk(null)}>
                  {tr("Cancel")}
                </Button>
                <Button
                  onClick={() => {
                    const go = ask.go;
                    setAsk(null);
                    go();
                  }}
                >
                  {ask.label}
                </Button>
              </div>
            </div>
          </DetailModal>
        )}
        {tab === "orgs" && (
          <ModalSection
            title={tr("Organisations brought by this partner")}
            icon={Building2}
            action={
              <Button onClick={() => setAdding(true)} disabled={!running || !p.active} className="!px-3 !py-1.5 flex items-center gap-1">
                <Plus size={14} /> {tr("Add for this partner")}
              </Button>
            }
          >
            {d.organisations.length === 0 ? (
              <ModalEmpty>{tr("None yet. The partner adds them from their portal, or you can add one for them.")}</ModalEmpty>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.organisations.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 border border-rule rounded-input px-3 py-2 text-sm">
                    <span>
                      <b>{o.name}</b>
                      <span className="text-muted"> · {o.admin.name} ({o.admin.email}){o.admin.invitePending ? ` · ${tr("Invite pending")}` : ""}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-center">
                        <MinimumCell o={o} />
                      </span>
                      <span className="text-muted">
                        {tr("{{used}} of {{n}} demo licences used · {{l}} learners", { used: o.demoUsed, n: o.demoLicences, l: o.learners })}
                        <br />
                        {tr("{{s}} started · {{p}} practice tests and {{m}} mock tests finished", { s: o.demoStarted, p: o.practiceDone, m: o.mocksDone })}
                      </span>
                      <button className="text-sm font-semibold text-navy cursor-pointer disabled:opacity-40" disabled={!running} onClick={() => setGiving(o)}>
                        {tr("Give licences")}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {adding && <AddOrganisation left={p.demoLicences - p.demoLicencesGiven} minLicences={1} endpoint={`/admin/channel-partners/${p.id}/organisations`} onClose={() => setAdding(false)} onDone={(name) => { setAdding(false); setMsg({ tone: "success", text: tr("{{name}} added for this partner.", { name }) }); load(); onChanged(); }} />}
            {giving && <GiveLicences org={giving} left={p.demoLicences - p.demoLicencesGiven} minLicences={1} endpoint={`/admin/channel-partners/${p.id}/organisations/${giving.id}/licences`} onClose={() => setGiving(null)} onDone={(n) => { setMsg({ tone: "success", text: tr("{{n}} demo licences given to {{name}}.", { n, name: giving.name }) }); setGiving(null); load(); onChanged(); }} />}
          </ModalSection>
        )}
        {tab === "orders" && (
          <ModalSection title={tr("Orders from this partner")} icon={Receipt}>
            <OrdersPanel mode="staff" partnerId={p.id} />
          </ModalSection>
        )}
        {tab === "leads" && <StaffLeads partnerId={p.id} onChanged={load} />}
        {tab === "people" && <StaffAffiliatePeople partnerId={p.id} />}
        {tab === "earnings" && <StaffEarnings partnerId={p.id} />}
        {tab === "agreement" && (
          <>
            <ModalSection title={tr("Signed agreements")} icon={FileSignature}>
              {d.agreements.length === 0 ? (
                <ModalEmpty>{tr("Not signed yet. The partner signs in the portal at first sign-in and after each renewal.")}</ModalEmpty>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {d.agreements.map((a, i) => (
                    <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-rule pb-2">
                      <span>
                        <b>{a.signedName}</b> <span className="text-muted">({a.signedEmail}) · {tr("version {{v}}", { v: a.version })}</span>
                        <br />
                        <span className="text-muted">{tr("For {{a}} to {{b}}", { a: fmtDay(a.periodStart), b: fmtDay(a.periodEnd) })}{a.ip ? ` · IP ${a.ip}` : ""}</span>
                      </span>
                      <span className="text-muted whitespace-nowrap">{new Date(a.signedAt).toLocaleString(appLocale())}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ModalSection>
            <ModalSection title={tr("Renewals")} icon={CalendarClock}>
              {d.renewals.length === 0 ? (
                <ModalEmpty>{tr("Not renewed yet.")}</ModalEmpty>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {d.renewals.map((x, i) => (
                    <li key={i} className="border-b border-rule pb-2">
                      <b>{tr("{{a}} → {{b}}", { a: fmtDay(x.previousEnd), b: fmtDay(x.newEnd) })}</b>
                      <span className="text-muted"> · {tr("{{n}} of {{min}} organisations", { n: x.organisations, min: x.minOrganisations })}{x.by ? ` · ${x.by}` : ""} · {fmtDay(x.at)}</span>
                      {x.overrideReason && <p className="text-navy-deep">{tr("Renewed below minimum: {{r}}", { r: x.overrideReason })}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </ModalSection>
          </>
        )}
        {tab === "history" && (
          <ModalSection title={tr("History")} icon={History}>
            <ul className="flex flex-col gap-2">
              {d.history.map((h, i) => (
                <li key={i} className="flex justify-between gap-3 border-b border-rule pb-2 text-sm">
                  <span>
                    <b>{actionLabel(h.action)}</b>
                    {h.by ? <span className="text-muted"> · {h.by}</span> : null}
                  </span>
                  <span className="text-muted whitespace-nowrap">{new Date(h.at).toLocaleString(appLocale())}</span>
                </li>
              ))}
            </ul>
          </ModalSection>
        )}
      </div>
    </DetailModal>
  );
}

// Referral Partner leads: Spica follows each one up, marks it won and links
// the organisation; the fee is earned at that organisation's first paid purchase.
function StaffLeads({ partnerId, onChanged }: { partnerId: string; onChanged: () => void }) {
  const [leads, setLeads] = useState<PartnerLead[] | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const load = () => partnerLeads(partnerId).then((r) => setLeads(r.leads)).catch(() => setLeads([]));
  useEffect(() => {
    load();
    api<{ organisations: { id: string; name: string }[] }>("/admin/partner-orders/organisations").then((r) => setOrgs(r.organisations)).catch(() => setOrgs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);
  const save = async (l: PartnerLead, b: Parameters<typeof updatePartnerLead>[1]) => {
    setMsg(null);
    try {
      await updatePartnerLead(l.id, b);
      setMsg({ tone: "success", text: tr("Saved.") });
      load();
      onChanged();
    } catch (e) {
      const m = String((e as Error).message ?? "");
      setMsg({ tone: "error", text: m.includes("organisation_required") ? tr("Link the organisation before marking it won.") : m.includes("organisation_already_linked") ? tr("That organisation is already linked to another referral.") : tr("That didn't work. Try again.") });
    }
  };
  if (!leads) return <ModalEmpty>{tr("Loading…")}</ModalEmpty>;
  return (
    <ModalSection title={tr("Referrals from this partner")} icon={Megaphone}>
      {msg && (
        <Notice tone={msg.tone} onClose={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}
      {leads.length === 0 ? (
        <ModalEmpty>{tr("No referrals yet.")}</ModalEmpty>
      ) : (
        <ul className="flex flex-col gap-3">
          {leads.map((l) => (
            <li key={l.id} className="border border-rule rounded-input p-3 text-sm flex flex-col gap-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  <b>{l.organisationName}</b> <span className="text-muted">· {l.category === "university" ? tr("University or college") : tr("Company")} · {l.country}</span>
                  <br />
                  <span className="text-muted">
                    {l.contactName} · {l.contactEmail}
                    {l.contactPhone ? ` · ${l.contactPhone}` : ""}
                    {l.expectedLearners ? ` · ${tr("{{n}} learners expected", { n: l.expectedLearners })}` : ""}
                  </span>
                  {l.notes && <p className="text-muted">{l.notes}</p>}
                </span>
                <span className="text-muted whitespace-nowrap">{fmtDay(l.createdAt)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select className={`${input} !w-auto`} value={l.status} disabled={l.status === "withdrawn"} onChange={(e) => save(l, { status: e.target.value as PartnerLead["status"] })}>
                  {(l.status === "withdrawn" ? (["withdrawn"] as const) : (["submitted", "contacted", "won", "lost", "duplicate"] as const)).map((s) => (
                    <option key={s} value={s}>
                      {leadStatusLabel(s)}
                    </option>
                  ))}
                </select>
                <select className={`${input} !w-auto max-w-xs`} value={l.tenantId ?? ""} onChange={(e) => save(l, { tenantId: e.target.value || null })}>
                  <option value="">{tr("Organisation it became…")}</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <input className={`${input} !w-auto flex-1 min-w-40`} defaultValue={l.staffNote ?? ""} placeholder={tr("Note (Spica only)")} onBlur={(e) => e.target.value !== (l.staffNote ?? "") && save(l, { staffNote: e.target.value || null })} />
              </div>
              <input
                className={input}
                defaultValue={l.partnerReason ?? ""}
                maxLength={500}
                placeholder={tr("Reason the partner sees (for example why it was lost)")}
                onBlur={(e) => e.target.value !== (l.partnerReason ?? "") && save(l, { partnerReason: e.target.value || null })}
              />
              {(l.possibleMatches ?? []).map((m) => (
                <div key={m.tenantId} className="flex flex-wrap items-center justify-between gap-2 rounded-input bg-warning/10 border border-warning/30 px-3 py-2">
                  <span>{tr("Possible match: {{name}} signed up by itself and looks like this referral.", { name: m.name })}</span>
                  <Button className="!px-3 !py-1.5" onClick={() => save(l, { status: "won", tenantId: m.tenantId })}>
                    {tr("Link and mark won")}
                  </Button>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </ModalSection>
  );
}

// What an Affiliate or Referral Partner has earned; Finance marks it paid.
// An Affiliate's track record for Spica staff (owner, 20 Nov 2026): link
// clicks and every person credited to it, how, and what they bought.
interface AffiliatePerson {
  id: string;
  name: string;
  email: string;
  signedUpAt: string;
  creditedAt: string | null;
  via: "link" | "code" | "plans" | null;
  deleted: boolean;
  purchases: number;
  spent: Record<string, number>;
  earned: Record<string, number>;
  possibleSelfReferral: boolean;
}
const VIA: Record<string, string> = { link: tr("Their link"), code: tr("Code typed at sign-up"), plans: tr("Code typed on the Plans page") };
const moneyMap = (m: Record<string, number>) => (Object.keys(m).length ? Object.entries(m).map(([c, n]) => minorMoney(n, c)).join(" + ") : "—");
function StaffAffiliatePeople({ partnerId }: { partnerId: string }) {
  const [d, setD] = useState<{ clicks: { total: number; last30: number }; people: AffiliatePerson[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<{ clicks: { total: number; last30: number }; people: AffiliatePerson[] }>(`/admin/channel-partners/${partnerId}/referred`).then(setD).catch(() => setFailed(true));
  }, [partnerId]);
  if (failed) return <Notice tone="error">{tr("Could not load the people credited to this partner.")}</Notice>;
  if (!d) return <ModalEmpty>{tr("Loading…")}</ModalEmpty>;
  const buyers = d.people.filter((x) => x.purchases > 0).length;
  const flagged = d.people.filter((x) => x.possibleSelfReferral).length;
  return (
    <ModalSection title={tr("People credited")} icon={Megaphone}>
      <p className="text-sm">
        {tr("{{c}} link clicks ({{c30}} in the last 30 days) · {{s}} sign-ups · {{b}} bought something", { c: d.clicks.total, c30: d.clicks.last30, s: d.people.length, b: buyers })}
      </p>
      {flagged > 0 && <Notice tone="error">{tr("{{n}} of these share the partner's own email address or company domain. Check them before paying earnings.", { n: flagged })}</Notice>}
      {d.people.length === 0 ? (
        <ModalEmpty>{tr("Nobody has signed up with this partner's link or code yet.")}</ModalEmpty>
      ) : (
        <div className="overflow-x-auto border border-rule rounded-input">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-paper-warm/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <tr>
                {[tr("Person"), tr("Credited"), tr("How"), tr("Purchases"), tr("Spent (before tax)"), tr("Partner earned")].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.people.map((x) => (
                <tr key={x.id} className="border-t border-rule">
                  <td className="px-3 py-2">
                    <p className="font-semibold">{x.name || "—"}</p>
                    <p className="text-xs text-muted">{x.email}</p>
                    {x.possibleSelfReferral && <StatusPill tone="error">{tr("Possible self-referral")}</StatusPill>}
                    {x.deleted && <StatusPill tone="muted">{tr("Account deleted")}</StatusPill>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDay(x.creditedAt ?? x.signedUpAt)}</td>
                  <td className="px-3 py-2">{x.via ? VIA[x.via] : "—"}</td>
                  <td className="px-3 py-2">{x.purchases}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{moneyMap(x.spent)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{moneyMap(x.earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ModalSection>
  );
}

// Where Spica sends this partner's money (Finance only). Without details the
// partner can't be paid; they are reminded weekly to add them in their Profile.
interface PayoutDetails {
  method: "bank" | "paypal";
  accountName: string | null;
  accountNumber: string | null;
  bankName: string | null;
  bankCode: string | null;
  bankCountry: string | null;
  paypalEmail: string | null;
  pan: string | null;
  gstin: string | null;
  updatedAt: string;
}
function PayoutDetailsBox({ partnerId }: { partnerId: string }) {
  const [d, setD] = useState<{ details: PayoutDetails | null } | "forbidden" | null>(null);
  useEffect(() => {
    api<{ details: PayoutDetails | null }>(`/admin/channel-partners/${partnerId}/payout-details`)
      .then(setD)
      .catch(() => setD("forbidden"));
  }, [partnerId]);
  if (!d) return null;
  if (d === "forbidden") return <p className="text-xs text-muted">{tr("Only staff with the Finance permission can see payout details.")}</p>;
  const x = d.details;
  if (!x) return <Notice tone="error">{tr("No payout details yet. Spica can't pay this partner until they add them in their Profile.")}</Notice>;
  const rows: [string, string | null][] =
    x.method === "bank"
      ? [
          [tr("Paid by"), tr("Bank transfer")],
          [tr("Account name"), x.accountName],
          [tr("Account number"), x.accountNumber],
          [tr("Bank"), [x.bankName, x.bankCountry].filter(Boolean).join(", ") || null],
          [tr("IFSC or SWIFT code"), x.bankCode],
        ]
      : [
          [tr("Paid by"), "PayPal"],
          [tr("PayPal email"), x.paypalEmail],
        ];
  if (x.pan) rows.push([tr("PAN"), x.pan]);
  if (x.gstin) rows.push([tr("GSTIN"), x.gstin]);
  return (
    <div className="rounded-input border border-rule bg-paper-warm/60 p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">{tr("Payout details")}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="font-mono">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted mt-1">{tr("Updated {{d}}", { d: fmtDay(x.updatedAt) })}</p>
    </div>
  );
}

function StaffEarnings({ partnerId }: { partnerId: string }) {
  const [d, setD] = useState<EarningsResponse | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [paying, setPaying] = useState<{ id: string; ref: string; void?: boolean } | null>(null);
  const load = () => partnerEarnings(partnerId).then(setD).catch(() => setD({ earnings: [], totals: {} }));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);
  if (!d) return <ModalEmpty>{tr("Loading…")}</ModalEmpty>;
  const act = async () => {
    if (!paying) return;
    try {
      if (paying.void) await voidEarning(paying.id, paying.ref);
      else await markEarningPaid(paying.id, paying.ref);
      setPaying(null);
      setMsg({ tone: "success", text: tr("Saved.") });
      load();
    } catch (e) {
      const m = String((e as Error).message ?? "");
      setMsg({ tone: "error", text: m.includes("payout_details_missing") ? tr("This partner hasn't added payout details yet, so they can't be paid. They're reminded to add them in their Profile.") : m.includes("forbidden") ? tr("Only staff with the Finance permission can do this.") : tr("That didn't work. Try again.") });
    }
  };
  return (
    <ModalSection title={tr("Earnings")} icon={Coins}>
      <PayoutDetailsBox partnerId={partnerId} />
      {msg && (
        <Notice tone={msg.tone} onClose={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        {Object.entries(d.totals).map(([c, t]) => (
          <span key={c} className="rounded-input bg-paper-warm px-3 py-2">
            {tr("{{e}} earned · {{p}} paid · {{o}} to pay", { e: minorMoney(t.earned, c), p: minorMoney(t.paid, c), o: minorMoney(t.earned - t.paid, c) })}
          </span>
        ))}
      </div>
      {d.earnings.length === 0 ? (
        <ModalEmpty>{tr("Nothing earned yet.")}</ModalEmpty>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {d.earnings.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2">
              <span>
                <b>{e.description}</b>
                <span className="text-muted"> · {fmtDay(e.earnedAt)}{e.rate != null ? ` · ${e.rate}% ${tr("of")} ${minorMoney(e.baseAmount, e.currency)}` : ""}</span>
                {e.status === "paid" && <span className="text-muted"> · {tr("Paid {{d}}, ref {{r}}", { d: fmtDay(e.paidAt), r: e.paidReference ?? "" })}</span>}
                {e.status === "void" && <span className="text-muted"> · {tr("Cancelled: {{r}}", { r: e.voidReason ?? "" })}</span>}
              </span>
              <span className="flex items-center gap-2">
                <b>{minorMoney(e.amount, e.currency)}</b>
                {e.status === "earned" && (
                  <>
                    <button className="text-sm font-semibold text-navy cursor-pointer" onClick={() => setPaying({ id: e.id, ref: "" })}>
                      {tr("Mark paid")}
                    </button>
                    <button className="text-sm text-muted cursor-pointer" onClick={() => setPaying({ id: e.id, ref: "", void: true })}>
                      {tr("Cancel")}
                    </button>
                  </>
                )}
              </span>
              {paying?.id === e.id && (
                <span className="flex w-full gap-2">
                  <input className={input} value={paying.ref} onChange={(x) => setPaying({ ...paying, ref: x.target.value })} placeholder={paying.void ? tr("Why it is cancelled") : tr("Payment reference")} />
                  <Button disabled={paying.ref.trim().length < 2} onClick={act}>
                    {tr("Save")}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </ModalSection>
  );
}
