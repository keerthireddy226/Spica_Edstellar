// An Affiliate's track record (owner, 20 Nov 2026): its results without ever
// showing who the people are. The funnel (clicks, sign-ups, buyers, earnings),
// month by month, by link source (with a tagged-link maker), an anonymous list
// of the people it brought, and Spica's payouts.
import { useEffect, useState } from "react";
import { Coins, Copy, MousePointerClick, ShoppingCart, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/Button";
import { EmptyNote, PageError, PageHeader, PageLoading, StatCard, StatusPill } from "@/components/staff/StaffKit";
import { tr } from "@/i18n/tr";
import { fmtDay, minorMoney } from "@/components/partner/partnerUi";
import { appLocale } from "@/lib/locale";

type Money = Record<string, number>;
interface TrackRecord {
  code: string;
  link: string;
  ratePercent: number;
  funnel: { clicks: number; signups: number; linkSignups: number; buyers: number; earned: Money; paid: Money };
  months: { month: string; clicks: number; signups: number; buyers: number; earned: Money }[];
  sources: { src: string; clicks: number; signups: number; buyers: number }[];
  people: { number: number; joinedAt: string; via: "link" | "code" | "plans" | null; src: string | null; purchases: { what: string; paidAt: string; amount: number; currency: string; earned: number }[] }[];
  payouts: { paidAt: string; reference: string | null; amounts: Money; items: number }[];
}

const moneyText = (m: Money) => (Object.keys(m).length ? Object.entries(m).map(([c, n]) => minorMoney(n, c)).join(" + ") : minorMoney(0, "USD"));
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const monthLabel = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString(appLocale(), { month: "long", year: "numeric" });
const VIA: Record<string, string> = { link: tr("Your link"), code: tr("Typed your code at sign-up"), plans: tr("Typed your code on the Plans page") };
const card = "bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted";

// A Referral Partner's track record (owner, 20 Nov 2026).
interface ReferralRecord {
  kind: "referral";
  referral: { total: number; open: number; contacted: number; won: number; lost: number; duplicate: number; withdrawn: number; winRate: number | null; avgDaysToWin: number | null; earned: Money; paid: Money };
  months: { month: string; referrals: number; won: number; earned: Money }[];
  payouts: TrackRecord["payouts"];
}

export function PartnerTrackRecord() {
  const [d, setD] = useState<TrackRecord | ReferralRecord | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => api<TrackRecord | ReferralRecord>("/partner/track-record").then(setD).catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, []);
  if (failed) return <PageError message={tr("Could not load your track record.")} onRetry={load} />;
  if (!d) return <PageLoading />;
  if ("kind" in d && d.kind === "referral") return <ReferralTrackRecord d={d} />;
  return <AffiliateTrackRecord d={d as TrackRecord} />;
}

function AffiliateTrackRecord({ d }: { d: TrackRecord }) {
  const f = d.funnel;
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Track record")} subtitle={tr("Your results: who clicked, signed up and bought. For their privacy you never see names or emails.")} />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={MousePointerClick} value={f.clicks} label={tr("Link clicks")} sub={tr("One per visitor per day")} progress={f.clicks ? 1 : 0} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={UserPlus} value={f.signups} label={tr("Sign-ups")} sub={tr("{{p}} of clicks signed up through the link", { p: pct(f.linkSignups, f.clicks) })} progress={f.clicks ? Math.min(1, f.linkSignups / f.clicks) : 0} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={ShoppingCart} value={f.buyers} label={tr("Buyers")} sub={tr("{{p}} of sign-ups bought something", { p: pct(f.buyers, f.signups) })} progress={f.signups ? f.buyers / f.signups : 0} />
        <StatCard variant="ledger" palette="terracotta" index={3} icon={Coins} value={moneyText(f.earned)} label={tr("Earned")} sub={tr("Paid so far: {{p}}", { p: moneyText(f.paid) })} progress={0.5} />
      </div>

      <section className={card}>
        <h2 className="font-display font-bold text-lg text-ink">{tr("Month by month")}</h2>
        {d.months.length === 0 ? (
          <EmptyNote>{tr("Nothing yet. Share your link to get started.")}</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-paper-warm/60">
                <tr>
                  {[tr("Month"), tr("Link clicks"), tr("Sign-ups"), tr("Buyers"), tr("Earned")].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.months.map((m) => (
                  <tr key={m.month} className="border-t border-rule">
                    <td className="px-3 py-2 font-semibold">{monthLabel(m.month)}</td>
                    <td className="px-3 py-2">{m.clicks}</td>
                    <td className="px-3 py-2">{m.signups}</td>
                    <td className="px-3 py-2">{m.buyers}</td>
                    <td className="px-3 py-2">{Object.keys(m.earned).length ? moneyText(m.earned) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Sources d={d} />

      <section className={card}>
        <h2 className="font-display font-bold text-lg text-ink">{tr("People you brought")}</h2>
        <p className="text-sm text-muted">{tr("Numbered in the order they joined. Spica never shows you their name, email, scores or reports.")}</p>
        {d.people.length === 0 ? (
          <EmptyNote>{tr("Nobody yet.")}</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-paper-warm/60">
                <tr>
                  {[tr("Person"), tr("Joined"), tr("How"), tr("Bought"), tr("You earned")].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.people.map((x) => (
                  <tr key={x.number} className="border-t border-rule align-top">
                    <td className="px-3 py-2 font-semibold">{tr("Person {{n}}", { n: x.number })}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDay(x.joinedAt)}</td>
                    <td className="px-3 py-2">
                      {x.via ? VIA[x.via] : "—"}
                      {x.src && <span className="text-muted"> · {x.src}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {x.purchases.length === 0 ? (
                        <span className="text-muted">{tr("Nothing yet")}</span>
                      ) : (
                        x.purchases.map((b, i) => (
                          <p key={i}>
                            {b.what} · {minorMoney(b.amount, b.currency)} <span className="text-muted">· {fmtDay(b.paidAt)}</span>
                          </p>
                        ))
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-semibold">
                      {x.purchases.length ? moneyText(x.purchases.reduce((m: Money, b) => ((m[b.currency] = (m[b.currency] ?? 0) + b.earned), m), {})) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="font-display font-bold text-lg text-ink">{tr("Payouts from Spica")}</h2>
        {d.payouts.length === 0 ? (
          <EmptyNote>{tr("No payouts yet. Spica pays your earnings with a payment reference; each payout appears here.")}</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="bg-paper-warm/60">
                <tr>
                  {[tr("Paid on"), tr("Reference"), tr("Amount"), tr("Earnings")].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.payouts.map((x, i) => (
                  <tr key={i} className="border-t border-rule">
                    <td className="px-3 py-2">{fmtDay(x.paidAt)}</td>
                    <td className="px-3 py-2 text-muted">{x.reference || "—"}</td>
                    <td className="px-3 py-2 font-semibold">{moneyText(x.amounts)}</td>
                    <td className="px-3 py-2">{x.items}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// Clicks and sign-ups per link source, and a maker for a tagged link per channel.
function Sources({ d }: { d: TrackRecord }) {
  const [tag, setTag] = useState("");
  const [copied, setCopied] = useState(false);
  const clean = tag.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  const link = clean ? `${d.link}&src=${clean}` : d.link;
  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <section className={card}>
      <h2 className="font-display font-bold text-lg text-ink">{tr("By source")}</h2>
      <p className="text-sm text-muted">{tr("Make one link per place you share it (YouTube, WhatsApp, Instagram…) to see which works best.")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Where will you share it?")}</span>
          <input className="rounded-input border border-rule bg-surface px-3 py-2 text-sm w-56" placeholder="youtube" value={tag} onChange={(e) => setTag(e.target.value)} />
        </label>
        <input readOnly value={link} onFocus={(e) => e.target.select()} className="flex-1 min-w-64 rounded-input border border-rule bg-paper-warm px-3 py-2 text-sm font-mono" />
        <Button variant="secondary" onClick={copy} className="flex items-center gap-1.5">
          <Copy size={14} /> {copied ? tr("Copied") : tr("Copy")}
        </Button>
      </div>
      {d.sources.length === 0 ? (
        <EmptyNote>{tr("No clicks yet.")}</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-paper-warm/60">
              <tr>
                {[tr("Source"), tr("Link clicks"), tr("Sign-ups"), tr("Buyers"), tr("Sign-up rate")].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.sources.map((s) => (
                <tr key={s.src} className="border-t border-rule">
                  <td className="px-3 py-2 font-semibold">{s.src ? s.src : <StatusPill tone="muted">{tr("Plain link")}</StatusPill>}</td>
                  <td className="px-3 py-2">{s.clicks}</td>
                  <td className="px-3 py-2">{s.signups}</td>
                  <td className="px-3 py-2">{s.buyers}</td>
                  <td className="px-3 py-2">{pct(s.signups, s.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">{tr("People who typed your code instead of using a link are counted in Sign-ups above, not here.")}</p>
    </section>
  );
}

function ReferralTrackRecord({ d }: { d: ReferralRecord }) {
  const r = d.referral;
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Track record")} subtitle={tr("How your referrals are doing: how many became customers, how fast, and what you earned.")} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={UserPlus} value={r.total} label={tr("Referrals")} sub={tr("{{n}} being followed up", { n: r.open })} progress={r.total ? r.open / r.total : 0} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={ShoppingCart} value={r.won} label={tr("Became customers")} sub={r.winRate === null ? tr("No decided referrals yet") : tr("{{p}}% of decided referrals won", { p: r.winRate })} progress={r.winRate === null ? 0 : r.winRate / 100} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={MousePointerClick} value={r.avgDaysToWin === null ? "—" : tr("{{n}} days", { n: r.avgDaysToWin })} label={tr("Average time to win")} sub={tr("From your referral to becoming a customer")} progress={0.5} />
        <StatCard variant="ledger" palette="terracotta" index={3} icon={Coins} value={moneyText(r.earned)} label={tr("Earned")} sub={tr("Paid so far: {{p}}", { p: moneyText(r.paid) })} progress={0.5} />
      </div>
      <section className={card}>
        <h2 className="font-display font-bold text-lg text-ink">{tr("Where your referrals are")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
          {[
            [tr("Sent"), r.total],
            [tr("Contacted by Spica"), r.contacted],
            [tr("Won"), r.won],
            [tr("Lost"), r.lost],
            [tr("Already known"), r.duplicate],
            [tr("Withdrawn"), r.withdrawn],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-input bg-paper-warm/70 px-3 py-2">
              <p className="text-xs text-muted">{k}</p>
              <p className="text-xl font-bold text-ink">{v}</p>
            </div>
          ))}
        </div>
      </section>
      <section className={card}>
        <h2 className="font-display font-bold text-lg text-ink">{tr("Month by month")}</h2>
        {d.months.length === 0 ? (
          <EmptyNote>{tr("Nothing yet. Refer an organisation to get started.")}</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="bg-paper-warm/60">
                <tr>
                  {[tr("Month"), tr("Referrals"), tr("Won"), tr("Earned")].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.months.map((m) => (
                  <tr key={m.month} className="border-t border-rule">
                    <td className="px-3 py-2 font-semibold">{monthLabel(m.month)}</td>
                    <td className="px-3 py-2">{m.referrals}</td>
                    <td className="px-3 py-2">{m.won}</td>
                    <td className="px-3 py-2">{Object.keys(m.earned).length ? moneyText(m.earned) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Payouts payouts={d.payouts} />
    </div>
  );
}

function Payouts({ payouts }: { payouts: TrackRecord["payouts"] }) {
  return (
    <section className={card}>
      <h2 className="font-display font-bold text-lg text-ink">{tr("Payouts from Spica")}</h2>
      {payouts.length === 0 ? (
        <EmptyNote>{tr("No payouts yet. Spica pays your earnings with a payment reference; each payout appears here.")}</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-paper-warm/60">
              <tr>
                {[tr("Paid on"), tr("Reference"), tr("Amount"), tr("Earnings")].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payouts.map((x, i) => (
                <tr key={i} className="border-t border-rule">
                  <td className="px-3 py-2">{fmtDay(x.paidAt)}</td>
                  <td className="px-3 py-2 text-muted">{x.reference || "—"}</td>
                  <td className="px-3 py-2 font-semibold">{moneyText(x.amounts)}</td>
                  <td className="px-3 py-2">{x.items}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
