import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarClock, Coins, Copy, FileSignature, Link2, Megaphone, MousePointerClick, Plus, ShoppingCart, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { EmptyNote, Notice, PageError, PageHeader, PageLoading, StatCard, StatusPill } from "@/components/staff/StaffKit";
import { DetailModal } from "@/components/DetailModal";
import { PayoutReminder } from "@/components/partner/PayoutDetailsCard";
import { tr } from "@/i18n/tr";
import { ROUTES } from "@/constants/routes";
import type { EarningsResponse, PartnerLead, PartnerType, PartnershipStatus } from "@/api/channelPartners";
import { fmtDay, leadStatusLabel, minorMoney, PartnershipPill, typeBlurb, typeLabel } from "@/components/partner/partnerUi";

// The partner portal around every page (user, 19 Nov 2026): the partnership
// bar (always visible: type, status, dates, minimums, agreement), the
// agreement gate (sign before acting, each period), and once-per-sign-in
// pop-ups when the partnership ends soon or has ended (read-only).

export interface PartnerMe {
  partner: { id: string; fullName: string; email: string; code: string; ownLicenceEnabled: boolean; commissionPercent?: number; type: PartnerType; typeLabel: string };
  demo: { total: number; given: number; left: number; status: "not_started" | "active" | "ended"; startsAt: string | null; endsAt: string | null; giftValidDays: number; giftGraceDays: number };
  partnership: { status: PartnershipStatus; readOnly: boolean; startsAt: string | null; endsAt: string | null; daysLeft: number | null; expiringDays: number; terminatedAt: string | null; terminationReason: string | null };
  agreement: { signed: boolean; signedAt: string | null; signedName: string | null; version: string | null };
  // current = organisations at the licence minimum (they count); added = all active ones.
  minimums: { organisations: number; current: number; added?: number; licencesPerOrg: number } | null;
  rates: { commissionPercent: number; discountPercent: number; referralFee: number; referralFeeCurrency: string };
}

// One request shared by the sidebar, the gate and the pages; reload after a change.
let cache: Promise<PartnerMe> | null = null;
let cacheUser: string | null = null;
// A different partner signing in on the same tab never sees the last one's account.
function forUser(id: string | undefined) {
  if ((id ?? null) !== cacheUser) {
    cache = null;
    cacheUser = id ?? null;
  }
}
const listeners = new Set<(m: PartnerMe) => void>();
export function reloadPartnerMe() {
  cache = api<PartnerMe>("/partner/me");
  cache.then((m) => listeners.forEach((f) => f(m))).catch(() => {});
  return cache;
}
export function usePartnerMe(enabled = true): { me: PartnerMe | null; failed: boolean; reload: () => void } {
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [failed, setFailed] = useState(false);
  const { user } = useAuth();
  useEffect(() => {
    if (!enabled) return;
    forUser(user?.id);
    listeners.add(setMe);
    (cache ?? reloadPartnerMe()).then(setMe).catch(() => setFailed(true));
    return () => {
      listeners.delete(setMe);
    };
  }, [user?.id, enabled]);
  return {
    me,
    failed,
    reload: () => {
      setFailed(false);
      reloadPartnerMe().catch(() => setFailed(true));
    },
  };
}

// The partner's type for the menu; never asks the server for other roles.
export function usePartnerType(enabled: boolean): PartnerType | null {
  const [t, setT] = useState<PartnerType | null>(null);
  const { user } = useAuth();
  useEffect(() => {
    if (!enabled) return setT(null);
    forUser(user?.id);
    const f = (m: PartnerMe) => setT(m.partner.type);
    listeners.add(f);
    (cache ?? reloadPartnerMe()).then(f).catch(() => {});
    return () => {
      listeners.delete(f);
    };
  }, [enabled, user?.id]);
  return t;
}

const AGREEMENT_PATH = "/partner/agreement";
const FREE_PATHS = [AGREEMENT_PATH, ROUTES.PARTNER_PROFILE];

export function PartnerGate() {
  const { me, failed, reload } = usePartnerMe();
  const { pathname } = useLocation();
  if (failed) return <PageError message={tr("Could not load your partner account.")} onRetry={reload} />;
  if (!me) return <PageLoading />;
  const s = me.partnership;
  // Sign the agreement for this period before anything else.
  if (!s.readOnly && s.status !== "not_started" && !me.agreement.signed && !FREE_PATHS.includes(pathname)) return <Navigate to={AGREEMENT_PATH} replace />;
  return (
    <div className="flex flex-col gap-4 w-full">
      <PartnershipBar me={me} />
      <PartnerPopups me={me} />
      <Outlet />
    </div>
  );
}

// Always visible at the top of every partner page.
export function PartnershipBar({ me }: { me: PartnerMe }) {
  const s = me.partnership;
  const m = me.minimums;
  const rate =
    me.partner.type === "reseller"
      ? tr("{{n}}% discount on list prices", { n: me.rates.discountPercent })
      : me.partner.type === "referral"
        ? tr("{{fee}} per referral", { fee: minorMoney(me.rates.referralFee, me.rates.referralFeeCurrency) })
        : tr("{{n}}% commission", { n: me.rates.commissionPercent });
  return (
    <div className="flex flex-col gap-2">
      <PayoutReminder />
      <div className="bg-surface border border-rule rounded-card px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="font-semibold">{typeLabel(me.partner.type)}</span>
        <span className="font-mono text-xs text-muted">{me.partner.code}</span>
        <PartnershipPill status={s.status} endsAt={s.endsAt} />
        <span className="flex items-center gap-1.5 text-muted">
          <CalendarClock size={14} />
          {s.startsAt ? tr("{{a}} to {{b}}", { a: fmtDay(s.startsAt), b: fmtDay(s.endsAt) }) : tr("Not started yet")}
        </span>
        {m && (
          <span className={m.current < m.organisations ? "text-error font-semibold" : "text-success font-semibold"}>
            {tr("Organisations: {{n}} of {{min}} needed", { n: m.current, min: m.organisations })}
          </span>
        )}
        {m && <span className="text-muted">{tr("Each counts once it has {{n}} licences in total", { n: m.licencesPerOrg })}{m.added != null && m.added > m.current ? ` · ${tr("{{k}} added still below", { k: m.added - m.current })}` : ""}</span>}
        <span className="text-muted">{rate}</span>
        <Link to={AGREEMENT_PATH} className="ml-auto flex items-center gap-1.5 font-semibold text-navy">
          <FileSignature size={14} />
          {me.agreement.signed ? tr("Agreement signed {{d}}", { d: fmtDay(me.agreement.signedAt) }) : tr("Agreement not signed")}
        </Link>
      </div>
      {s.readOnly && s.status !== "not_started" && (
        <Notice tone="error">
          {s.status === "terminated"
            ? tr("Your partnership was ended by Spica on {{d}}. Your portal is read-only: you can see your history, invoices and earnings, but can't add organisations, give licences, order or refer.", { d: fmtDay(s.terminatedAt) })
            : tr("Your partnership ended on {{d}}. Your portal is read-only until Spica renews it.", { d: fmtDay(s.endsAt) })}
        </Notice>
      )}
      {s.status === "not_started" && <Notice tone="info">{tr("Your partnership hasn't started yet. Spica will let you know when it does.")}</Notice>}
    </div>
  );
}

// Shown once per sign-in (stored for this browser tab only).
function PartnerPopups({ me }: { me: PartnerMe }) {
  const s = me.partnership;
  const key = `spica-partner-popup:${me.partner.id}:${s.status}:${s.endsAt ?? ""}`;
  const due = s.status === "expiring" || s.status === "expired" || s.status === "terminated";
  const [open, setOpen] = useState(() => {
    try {
      return due && !sessionStorage.getItem(key);
    } catch {
      return due;
    }
  });
  if (!open) return null;
  const close = () => {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode: show again next time */
    }
    setOpen(false);
  };
  const m = me.minimums;
  return (
    <DetailModal title={s.status === "expiring" ? tr("Your partnership ends soon") : tr("Your partnership has ended")} icon={AlertTriangle} onClose={close}>
      <div className="flex flex-col gap-3 text-sm">
        {s.status === "expiring" ? (
          <>
            <p>{tr("Your partnership ends on {{d}} ({{n}} days left). After that your portal becomes read-only.", { d: fmtDay(s.endsAt), n: s.daysLeft ?? 0 })}</p>
            {m && <p>{m.current >= m.organisations ? tr("You have reached your minimum of {{min}} organisations, so Spica can renew you for another 3 months.", { min: m.organisations }) : tr("Renewal needs {{min}} organisations; you have {{n}}. Add {{k}} more before {{d}}.", { min: m.organisations, n: m.current, k: m.organisations - m.current, d: fmtDay(s.endsAt) })}</p>}
            <p>{tr("Talk to your Spica contact about renewing. You will sign the agreement again for the new period.")}</p>
          </>
        ) : (
          <>
            <p>{s.status === "terminated" ? tr("Spica ended your partnership on {{d}}. Reason: {{r}}", { d: fmtDay(s.terminatedAt), r: s.terminationReason ?? "—" }) : tr("Your partnership ended on {{d}}.", { d: fmtDay(s.endsAt) })}</p>
            <p>{tr("Your portal is read-only: you can still see your history, invoices and earnings. Organisations and learners keep what they already have. Earnings on purchases paid before the end are still paid.")}</p>
          </>
        )}
        <div className="flex justify-end">
          <Button onClick={close}>{tr("I understand")}</Button>
        </div>
      </div>
    </DetailModal>
  );
}

// ---------- The agreement ----------

interface AgreementResponse {
  agreement: { version: string; title: string; label: string; periodStart: string | null; periodEnd: string | null; sections: { h: string; items: string[] }[] };
  signed: { signedName: string; signedAt: string; version: string } | null;
  history: { version: string; signedName: string; signedAt: string; periodStart: string | null; periodEnd: string | null }[];
  status: PartnershipStatus;
}

export function PartnerAgreement() {
  const [d, setD] = useState<AgreementResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();
  const load = () => api<AgreementResponse>("/partner/agreement").then(setD).catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, []);
  if (failed) return <PageError message={tr("Could not load your agreement.")} onRetry={load} />;
  if (!d) return <PageLoading />;
  const canSign = !d.signed && (d.status === "active" || d.status === "expiring");
  const sign = async () => {
    setErr(null);
    if (name.trim().length < 2) return setErr(tr("Type your full name to sign."));
    if (!agree) return setErr(tr("Tick the box to agree."));
    setBusy(true);
    try {
      await api("/partner/agreement/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: name.trim(), agree: true }) });
      await reloadPartnerMe();
      navigate(ROUTES.PARTNER_DASHBOARD);
    } catch {
      setErr(tr("Could not sign. Try again."));
      setBusy(false);
    }
  };
  const a = d.agreement;
  return (
    <div className="flex flex-col gap-5 w-full max-w-3xl">
      <PageHeader title={a.title} subtitle={tr("Version {{v}} · for {{a}} to {{b}}", { v: a.version, a: fmtDay(a.periodStart), b: fmtDay(a.periodEnd) })} />
      {canSign && <Notice tone="info">{tr("Read and sign your partnership agreement to start using the partner portal. You sign again each time the partnership is renewed.")}</Notice>}
      {d.signed && <Notice tone="success">{tr("Signed by {{n}} on {{d}} (version {{v}}).", { n: d.signed.signedName, d: new Date(d.signed.signedAt).toLocaleString(), v: d.signed.version })}</Notice>}
      <article className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-4 text-sm leading-relaxed">
        {a.sections.map((s) => (
          <section key={s.h} className="flex flex-col gap-1.5">
            <h2 className="font-display font-bold text-base">{s.h}</h2>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              {s.items.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-muted">
          {tr("The English version of this agreement applies. Parts in square brackets are still being completed by Edstellar.")}{" "}
          <a href="/legal/privacy-channel-partners.html" target="_blank" rel="noreferrer" className="underline">
            {tr("Privacy Notice for Partners")}
          </a>
        </p>
      </article>
      {canSign && (
        <div className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">{tr("Type your full name to sign")}</span>
            <input className="w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm focus:outline-none focus:border-navy" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-navy" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{tr("I have read this agreement and agree to it on behalf of the partner named above. My name, the date, time and my IP address are recorded as my signature.")}</span>
          </label>
          {err && <Notice tone="error">{err}</Notice>}
          <div className="flex justify-end">
            <Button onClick={sign} disabled={busy} className="flex items-center gap-1.5">
              <FileSignature size={16} /> {busy ? tr("Signing…") : tr("Sign the agreement")}
            </Button>
          </div>
        </div>
      )}
      {d.history.length > 0 && (
        <div className="bg-surface border border-rule rounded-card p-5">
          <h2 className="font-display font-bold mb-2">{tr("Signed before")}</h2>
          <ul className="text-sm flex flex-col gap-1">
            {d.history.map((h, i) => (
              <li key={i} className="text-muted">
                {tr("{{n}} signed version {{v}} on {{d}} for {{a}} to {{b}}", { n: h.signedName, v: h.version, d: fmtDay(h.signedAt), a: fmtDay(h.periodStart), b: fmtDay(h.periodEnd) })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- Affiliate ----------

interface AffiliateResponse extends EarningsResponse {
  code: string;
  link: string;
  ratePercent: number;
  clicks?: { total: number; last30: number };
  signups: number;
  linkSignups?: number;
  buyers: number;
}

const totalsText = (t: EarningsResponse["totals"], k: "earned" | "paid" | "due") =>
  Object.entries(t)
    .map(([c, v]) => minorMoney(k === "earned" ? v.earned : k === "paid" ? v.paid : v.earned - v.paid, c))
    .join(" + ") || "—";

function CopyField({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      })
      .catch(() => {});
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted uppercase tracking-wide">{label}</span>
      <span className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.target.select()} className="w-full rounded-input border border-rule bg-paper-warm px-3 py-2 text-sm font-mono" />
        <Button variant="secondary" onClick={copy} className="flex items-center gap-1.5 whitespace-nowrap">
          <Copy size={14} /> {done ? tr("Copied") : tr("Copy")}
        </Button>
      </span>
    </label>
  );
}

export function AffiliateDashboard({ me }: { me: PartnerMe }) {
  const [d, setD] = useState<AffiliateResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => api<AffiliateResponse>("/partner/affiliate").then(setD).catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, []);
  if (failed) return <PageError message={tr("Could not load your referral link.")} onRetry={load} />;
  if (!d) return <PageLoading />;
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Welcome, {{name}}", { name: me.partner.fullName })} subtitle={typeBlurb("affiliate")} />
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={MousePointerClick} value={d.clicks?.total ?? 0} label={tr("Link clicks")} sub={tr("{{n}} in the last 30 days", { n: d.clicks?.last30 ?? 0 })} progress={0.5} />
        <StatCard variant="ledger" palette="terracotta" index={0} icon={UserPlus} value={d.signups} label={tr("Sign-ups with your code")} sub={tr("{{n}} through your link, the rest typed your code", { n: d.linkSignups ?? 0 })} progress={d.clicks?.total ? Math.min(1, (d.linkSignups ?? 0) / d.clicks.total) : 0.5} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={ShoppingCart} value={d.buyers} label={tr("Bought something")} sub={tr("Paid purchases")} progress={d.signups ? d.buyers / d.signups : 0} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={Coins} value={totalsText(d.totals, "earned")} label={tr("Earned")} sub={tr("{{n}}% of each paid purchase, before tax", { n: d.ratePercent })} progress={0.5} />
        <StatCard variant="ledger" palette="terracotta" index={3} icon={Coins} value={totalsText(d.totals, "due")} label={tr("To be paid")} sub={tr("Paid so far: {{p}}", { p: totalsText(d.totals, "paid") })} progress={0} />
      </div>
      <div className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-4">
        <h2 className="font-display font-bold text-lg flex items-center gap-2">
          <Link2 size={18} className="text-navy" /> {tr("Your link and code")}
        </h2>
        {me.partnership.readOnly ? (
          <Notice tone="error">{tr("Your partnership has ended: new sign-ups with your link or code are not credited to you.")}</Notice>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <CopyField value={d.link} label={tr("Sign-up link")} />
            <CopyField value={d.code} label={tr("Partner code")} />
          </div>
        )}
        <ul className="text-sm text-muted list-disc pl-5 flex flex-col gap-1">
          <li>{tr("People are credited to you when they sign up with your link, or type your code at sign-up or on the plans page. No tracking cookies are used.")}</li>
          <li>{tr("You earn on their paid purchases during your partnership. You never see their name, email, scores or reports.")}</li>
          <li>{tr("Say clearly that you are paid for referrals, and describe Spica only as Spica's own materials do.")}</li>
        </ul>
      </div>
      <EarningsTable earnings={d.earnings.slice(0, 10)} title={tr("Latest purchases")} more={d.earnings.length > 10} />
    </div>
  );
}

function EarningsTable({ earnings, title, more }: { earnings: EarningsResponse["earnings"]; title: string; more?: boolean }) {
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
      <div className="p-4 border-b border-rule flex items-center gap-2">
        <Coins size={18} className="text-navy" />
        <h2 className="font-display font-bold text-lg">{title}</h2>
        {more && (
          <Link to="/partner/earnings" className="ml-auto text-sm font-semibold text-navy">
            {tr("See all")}
          </Link>
        )}
      </div>
      {earnings.length === 0 ? (
        <div className="p-6">
          <EmptyNote>{tr("Nothing earned yet.")}</EmptyNote>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide">
              <tr>
                {[tr("Date"), tr("What"), tr("Purchase"), tr("You earn"), tr("Status")].map((h) => (
                  <th key={h} className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {earnings.map((e) => (
                <tr key={e.id} className="border-t border-rule">
                  <td className="px-4 py-2.5 whitespace-nowrap">{fmtDay(e.earnedAt)}</td>
                  <td className="px-4 py-2.5">{e.description}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{e.rate != null ? `${minorMoney(e.baseAmount, e.currency)} · ${e.rate}%` : tr("Fixed fee")}</td>
                  <td className="px-4 py-2.5 font-semibold whitespace-nowrap">{minorMoney(e.amount, e.currency)}</td>
                  <td className="px-4 py-2.5">
                    {e.status === "paid" ? (
                      <StatusPill tone="success">{tr("Paid {{d}}", { d: fmtDay(e.paidAt) })}</StatusPill>
                    ) : e.status === "void" ? (
                      <StatusPill tone="muted">{tr("Cancelled")}</StatusPill>
                    ) : (
                      <StatusPill tone="warning">{tr("To be paid")}</StatusPill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PartnerEarnings() {
  const [d, setD] = useState<EarningsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => api<EarningsResponse>("/partner/earnings").then(setD).catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, []);
  if (failed) return <PageError message={tr("Could not load your earnings.")} onRetry={load} />;
  if (!d) return <PageLoading />;
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Earnings")} subtitle={tr("Earned {{e}} · paid {{p}} · to be paid {{o}}", { e: totalsText(d.totals, "earned"), p: totalsText(d.totals, "paid"), o: totalsText(d.totals, "due") })} />
      <EarningsTable earnings={d.earnings} title={tr("Everything you have earned")} />
      <p className="text-xs text-muted">{tr("Spica pays earnings after the purchase is paid, with a payment reference. Refunded purchases earn nothing.")}</p>
    </div>
  );
}

// ---------- Referral Partner ----------

export function ReferralDashboard({ me }: { me: PartnerMe }) {
  const [leads, setLeads] = useState<PartnerLead[] | null>(null);
  const [earn, setEarn] = useState<EarningsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PartnerLead | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const withdraw = async (l: PartnerLead) => {
    if (!window.confirm(tr("Withdraw the referral of {{org}}? Spica stops following it up, and it earns no fee.", { org: l.organisationName }))) return;
    try {
      await api(`/partner/leads/${l.id}/withdraw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setNotice(tr("Referral withdrawn."));
    } catch {
      setNotice(tr("Spica has already decided this referral, so it can't be withdrawn."));
    }
    load();
  };
  const load = () => {
    api<{ leads: PartnerLead[] }>("/partner/leads").then((r) => setLeads(r.leads)).catch(() => setFailed(true));
    api<EarningsResponse>("/partner/earnings").then(setEarn).catch(() => setEarn({ earnings: [], totals: {} }));
  };
  useEffect(load, []);
  if (failed) return <PageError message={tr("Could not load your referrals.")} onRetry={load} />;
  if (!leads || !earn) return <PageLoading />;
  const won = leads.filter((l) => l.status === "won").length;
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Welcome, {{name}}", { name: me.partner.fullName })}
        subtitle={typeBlurb("referral")}
        actions={
          <Button onClick={() => setAdding(true)} disabled={me.partnership.readOnly} className="flex items-center gap-1.5">
            <Plus size={16} /> {tr("Refer an organisation")}
          </Button>
        }
      />
      {notice && (
        <Notice tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Notice>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={Megaphone} value={leads.length} label={tr("Referrals")} sub={tr("{{n}} being followed up", { n: leads.filter((l) => l.status === "submitted" || l.status === "contacted").length })} progress={0.5} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={UserPlus} value={won} label={tr("Became customers")} sub={tr("Won by Spica")} progress={leads.length ? won / leads.length : 0} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={Coins} value={totalsText(earn.totals, "earned")} label={tr("Earned")} sub={tr("{{fee}} per first paid purchase", { fee: minorMoney(me.rates.referralFee, me.rates.referralFeeCurrency) })} progress={0.5} />
        <StatCard variant="ledger" palette="terracotta" index={3} icon={Coins} value={totalsText(earn.totals, "due")} label={tr("To be paid")} sub={tr("Paid so far: {{p}}", { p: totalsText(earn.totals, "paid") })} progress={0} />
      </div>
      <LeadsTable leads={leads} readOnly={me.partnership.readOnly} onEdit={setEditing} onWithdraw={withdraw} />
      <p className="text-xs text-muted">{tr("Only refer people who agreed to be contacted by Edstellar. You see the status of each referral, not the organisation's account, scores or reports.")}</p>
      {editing && (
        <ReferOrganisation
          existing={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setNotice(tr("Referral updated."));
            load();
          }}
        />
      )}
      {adding && (
        <ReferOrganisation
          onClose={() => setAdding(false)}
          onDone={(dup) => {
            setAdding(false);
            setNotice(dup ? tr("Referral sent. Spica may already know this organisation; we'll check and let you know.") : tr("Referral sent. Spica will contact them and keep you updated here."));
            load();
          }}
        />
      )}
    </div>
  );
}

function LeadsTable({ leads, readOnly, onEdit, onWithdraw }: { leads: PartnerLead[]; readOnly: boolean; onEdit: (l: PartnerLead) => void; onWithdraw: (l: PartnerLead) => void }) {
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
      <div className="p-4 border-b border-rule flex items-center gap-2">
        <Megaphone size={18} className="text-navy" />
        <h2 className="font-display font-bold text-lg">{tr("Your referrals")}</h2>
      </div>
      {leads.length === 0 ? (
        <div className="p-6">
          <EmptyNote>{tr("No referrals yet. Refer a university, college or company that wants to try Spica.")}</EmptyNote>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide">
              <tr>
                {[tr("Organisation"), tr("Contact"), tr("Country"), tr("Sent"), tr("Status"), ""].map((h) => (
                  <th key={h} className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t border-rule">
                  <td className="px-4 py-2.5">
                    <b>{l.organisationName}</b>
                    <p className="text-xs text-muted">{l.category === "university" ? tr("University or college") : tr("Company")}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {l.contactName}
                    <p className="text-xs text-muted">{l.contactEmail}</p>
                  </td>
                  <td className="px-4 py-2.5">{l.country}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{fmtDay(l.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={l.status === "won" ? "success" : l.status === "lost" || l.status === "duplicate" || l.status === "withdrawn" ? "muted" : "navy"}>{leadStatusLabel(l.status)}</StatusPill>
                    {l.partnerReason && <p className="text-xs text-muted mt-1 max-w-xs">{l.partnerReason}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {!readOnly && l.status === "submitted" && (
                      <button className="text-sm font-semibold text-navy cursor-pointer mr-3" onClick={() => onEdit(l)}>
                        {tr("Edit")}
                      </button>
                    )}
                    {!readOnly && (l.status === "submitted" || l.status === "contacted") && (
                      <button className="text-sm font-semibold text-muted hover:text-error cursor-pointer" onClick={() => onWithdraw(l)}>
                        {tr("Withdraw")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PartnerReferrals() {
  const { me } = usePartnerMe();
  if (!me) return <PageLoading />;
  return <ReferralDashboard me={me} />;
}

// A new referral, or (existing) changing one Spica hasn't contacted yet.
function ReferOrganisation({ existing, onClose, onDone }: { existing?: PartnerLead; onClose: () => void; onDone: (duplicate: boolean) => void }) {
  const [f, setF] = useState(
    existing
      ? { organisationName: existing.organisationName, category: existing.category, contactName: existing.contactName, contactEmail: existing.contactEmail, contactPhone: existing.contactPhone ?? "", country: existing.country, expectedLearners: existing.expectedLearners == null ? "" : String(existing.expectedLearners), notes: existing.notes ?? "" }
      : { organisationName: "", category: "company" as "company" | "university", contactName: "", contactEmail: "", contactPhone: "", country: "India", expectedLearners: "", notes: "" },
  );
  const [agreed, setAgreed] = useState(!!existing);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm focus:outline-none focus:border-navy";
  const label = "text-xs font-semibold text-muted uppercase tracking-wide";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setErr(null);
    if (f.organisationName.trim().length < 2) return setErr(tr("Enter the organisation's name."));
    if (f.contactName.trim().length < 2) return setErr(tr("Enter the contact's name."));
    if (!/^\S+@\S+\.\S+$/.test(f.contactEmail.trim())) return setErr(tr("Enter a valid email address."));
    if (f.country.trim().length < 2) return setErr(tr("Enter the country."));
    if (!agreed) return setErr(tr("Confirm the contact agreed to be contacted by Edstellar."));
    setBusy(true);
    try {
      const r = await api<{ lead: PartnerLead }>(existing ? `/partner/leads/${existing.id}` : "/partner/leads", {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationName: f.organisationName.trim(),
          category: f.category,
          contactName: f.contactName.trim(),
          contactEmail: f.contactEmail.trim(),
          contactPhone: f.contactPhone.trim() || null,
          country: f.country.trim(),
          expectedLearners: f.expectedLearners.trim() ? Math.max(0, Math.round(Number(f.expectedLearners) || 0)) : null,
          notes: f.notes.trim() || null,
          contactAgreed: true,
        }),
      });
      onDone(r.lead.status === "duplicate");
    } catch (e) {
      const m = String((e as Error).message ?? "");
      setErr(m.includes("lead_locked") ? tr("Spica has already contacted them, so this referral can't be changed.") : m.includes("partnership_not_active") ? tr("Your partnership has ended, so you can't send referrals.") : m.includes("agreement_not_signed") ? tr("Sign your partnership agreement first.") : tr("Could not send the referral. Try again."));
      setBusy(false);
    }
  };
  return (
    <DetailModal title={existing ? tr("Change the referral") : tr("Refer an organisation")} subtitle={tr("Spica contacts them. You earn the referral fee when they become a customer and make their first paid purchase within 6 months of your referral.")} icon={Megaphone} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Organisation name")}</span>
            <input className={input} value={f.organisationName} onChange={set("organisationName")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Type")}</span>
            <select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as "company" | "university" })}>
              <option value="company">{tr("Company")}</option>
              <option value="university">{tr("University or college")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Contact's full name")}</span>
            <input className={input} value={f.contactName} onChange={set("contactName")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Contact's email")}</span>
            <input className={input} type="email" value={f.contactEmail} onChange={set("contactEmail")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Contact's phone (optional)")}</span>
            <input className={input} value={f.contactPhone} maxLength={30} onChange={set("contactPhone")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Country")}</span>
            <input className={input} value={f.country} onChange={set("country")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Expected number of learners (optional)")}</span>
            <input className={input} type="number" min={0} value={f.expectedLearners} onChange={set("expectedLearners")} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("What they need (optional)")}</span>
          <textarea className={input} rows={2} value={f.notes} onChange={set("notes")} />
        </label>
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-navy" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{tr("The contact agreed that I share their details with Edstellar and that Edstellar may contact them about Spica.")}</span>
        </label>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? tr("Sending…") : tr("Send referral")}
          </Button>
        </div>
      </div>
    </DetailModal>
  );
}
