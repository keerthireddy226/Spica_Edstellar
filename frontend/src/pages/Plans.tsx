import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ProductShop } from "@/components/plans/ProductShop";
import { OwnedList, useMyAccess } from "@/components/learner/MyPlan";
import { Check, X as XIcon, FileText, Building2, Sparkles, CheckCircle2 } from "lucide-react";
import { LearnerHero } from "@/components/learner/LearnerHero";
import { ROUTES } from "@/constants/routes";
import { Button } from "@/components/Button";
import { useMyLicense } from "@/components/licenses/LicenseGate";
import { formatShortDate } from "@/api/licenses";
import {
  createPaymentOrder,
  formatAmount,
  getInvoices,
  getQuote,
  startCheckout,
  type InvoiceSummary,
  type Quote,
} from "@/api/payments";
import { getQuota, type QuotaTier } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

const PLAN_MONTHS = [1, 3, 6] as const;

// "Practice tests: 2 a month" lines for a tier, from the server's limits.
function testLimitLines(q: QuotaTier | undefined): { practice: string; mocks: string } | null {
  if (!q) return null;
  return {
    practice: q.practicePerMonth === null ? tr("Unlimited practice tests") : tr("Practice tests per month: {{n}}", { n: q.practicePerMonth }),
    mocks: q.mocksPerMonth === null ? tr("Unlimited mock tests") : tr("Mock tests per month: {{n}}", { n: q.mocksPerMonth }),
  };
}

function Feature({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <Check size={16} className="text-success shrink-0 mt-0.5" /> : <XIcon size={16} className="text-muted shrink-0 mt-0.5" />}
      <span className={ok ? "text-ink" : "text-muted"}>{children}</span>
    </li>
  );
}

// Individual learners only — organization learners get access from their org.
export function Plans() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const license = useMyLicense();
  const access = useMyAccess();
  // ?months=1 or 3 pre-selects the length (from the "keep going" card).
  const [months, setMonths] = useState<number>(() => {
    const m = Number(new URLSearchParams(window.location.search).get("months"));
    return m === 1 || m === 3 || m === 6 || m === 12 ? m : 3;
  });
  const [quotes, setQuotes] = useState<Record<number, Quote>>({});
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<QuotaTier[]>([]);

  useEffect(() => {
    getQuota()
      .then((r) => setTiers(r.tiers ?? []))
      .catch(() => {});
    Promise.all(PLAN_MONTHS.map((m) => getQuote(m).then((q) => [m, q] as const)))
      .then((pairs) => setQuotes(Object.fromEntries(pairs)))
      .catch(() => setError(t("plans.unavailable")));
    getInvoices()
      .then((r) => setInvoices(r.invoices))
      .catch(() => {});
  }, [t]);

  if (license && !license.individual) {
    return (
      <div className="max-w-xl mx-auto mt-6 bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col items-center text-center gap-3">
        <span className="h-14 w-14 rounded-2xl bg-navy/10 text-navy-deep flex items-center justify-center">
          <Building2 size={26} />
        </span>
        <p className="text-sm text-ink">{t("plans.orgManaged")}</p>
        <Link to={ROUTES.SPICA_PLANS} className="text-sm font-semibold text-navy-deep hover:underline">
          {tr("See every Spica plan")}
        </Link>
      </div>
    );
  }

  const active = license && (license.status === "active" || license.status === "grace");
  const freeTests = testLimitLines(tiers.find((x) => x.tier === "free"));
  const plusTests = testLimitLines(tiers.find((x) => x.tier === "plus"));
  const q = quotes[months];
  const monthly = quotes[1];

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      const order = await createPaymentOrder(months);
      await startCheckout(order, navigate);
    } catch {
      setError(t("plans.payError"));
      setPaying(false);
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
      <LearnerHero
        compact
        icon={Sparkles}
        eyebrow={tr("Your plan")}
        title={t("plans.title")}
        subtitle={active ? t("plans.activeUntil", { date: formatShortDate(license!.accessEndsAt) }) : t("plans.onFree")}
      />

      {/* What else the learner owns: preparation for one test, real tests, level tests. */}
      {access && access.owned.some((o) => o.kind !== "full") && (
        <div className="bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-col gap-3">
          <p className="font-display font-bold text-ink">{tr("Your plan")}</p>
          <OwnedList access={access} />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display font-bold text-lg text-ink">{t("plans.free.name")}</p>
              {/* Zero in the currency the prices below use. */}
              <p className="text-sm text-muted">{monthly ? formatAmount(0, monthly.currency) : t("plans.free.price")}</p>
            </div>
            {!active && (
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-pill bg-success/15 text-success whitespace-nowrap">
                <CheckCircle2 size={12} /> {tr("Your current plan")}
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            <Feature ok>{t("plans.features.placementOnce")}</Feature>
            <Feature ok>{t("plans.features.practiceLimited", { count: license?.freeTier?.practiceLimit ?? 3 })}</Feature>
            <Feature ok>{t("plans.features.progress")}</Feature>
            {freeTests ? (
              <>
                <Feature ok>{freeTests.practice}</Feature>
                <Feature ok>{freeTests.mocks}</Feature>
              </>
            ) : (
              <Feature ok={false}>{t("plans.features.mockTests")}</Feature>
            )}
            <Feature ok={false}>{t("plans.features.tutor")}</Feature>
            <Feature ok={false}>{tr("No certificate included")}</Feature>
          </ul>
          {!active && license?.freeTier && (
            <p className="text-xs text-muted mt-auto">
              {t("plans.free.usage", { used: license.freeTier.practiceUsed, limit: license.freeTier.practiceLimit })}
            </p>
          )}
        </div>

        <div className="bg-surface border-2 border-navy rounded-card shadow-md p-6 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
            <p className="font-display font-bold text-lg text-ink">{t("plans.full.name")}</p>
            <p className="text-sm text-muted">
              {monthly ? t("plans.full.perMonth", { price: formatAmount(monthly.unitAmount, monthly.currency) }) : "…"}
            </p>
            </div>
            {active && (
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-pill bg-success/15 text-success whitespace-nowrap">
                <CheckCircle2 size={12} /> {tr("Your current plan")}
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            <Feature ok>{t("plans.features.placementUnlimited")}</Feature>
            <Feature ok>{t("plans.features.practiceUnlimited")}</Feature>
            {plusTests ? (
              <>
                <Feature ok>{plusTests.practice}</Feature>
                <Feature ok>{plusTests.mocks}</Feature>
              </>
            ) : (
              <Feature ok>{t("plans.features.mockTests")}</Feature>
            )}
            <Feature ok>{t("plans.features.tutor")}</Feature>
            <Feature ok>{t("plans.features.progress")}</Feature>
            <Feature ok>{tr("One final assessment on the test you choose")}</Feature>
            <Feature ok>{tr("Certificate provided")}</Feature>
          </ul>

          <div className="grid grid-cols-3 gap-2">
            {PLAN_MONTHS.map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`rounded-input border px-3 py-2.5 text-center cursor-pointer transition-colors ${
                  months === m ? "border-navy bg-paper-warm" : "border-rule hover:border-rule-strong"
                }`}
              >
                <p className="text-sm font-semibold text-ink">{t("plans.months", { count: m })}</p>
                <p className="text-xs text-muted">{quotes[m] ? formatAmount(quotes[m].subtotal, quotes[m].currency) : "…"}</p>
              </button>
            ))}
          </div>

          {q && (
            <div className="text-sm flex flex-col gap-1 bg-paper-warm rounded-input px-3.5 py-2.5">
              <div className="flex justify-between">
                <span className="text-muted">{t("plans.months", { count: months })}</span>
                <span className="text-ink">{formatAmount(q.subtotal + (q.credit ?? 0), q.currency)}</span>
              </div>
              {(q.credit ?? 0) > 0 && (
                <div className="flex justify-between text-success">
                  <span>{tr("Credit for your unused preparation")}</span>
                  <span>−{formatAmount(q.credit!, q.currency)}</span>
                </div>
              )}
              {q.taxAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">{q.taxLabel}</span>
                  <span className="text-ink">{formatAmount(q.taxAmount, q.currency)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <span>{t("plans.total")}</span>
                <span>{formatAmount(q.total, q.currency)}</span>
              </div>
              <p className="text-xs text-muted mt-1">
                {active
                  ? t("plans.extendNote", { date: formatShortDate(license!.accessEndsAt) })
                  : t("plans.startNote")}
              </p>
              {q.testMode && <p className="text-xs text-navy-deep">{t("plans.testMode")}</p>}
            </div>
          )}

          {error && <p className="text-sm text-error">{error}</p>}
          <Button onClick={pay} disabled={paying || !q}>
            {paying ? t("plans.redirecting") : active ? t("plans.extend", { count: months }) : t("plans.buy", { count: months })}
          </Button>
        </div>
      </div>

      <ProductShop />

      {invoices.length > 0 && (
        <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-3">
          <p className="font-display font-bold text-ink flex items-center gap-2">
            <FileText size={17} className="text-navy-deep" /> {t("plans.invoices")}
          </p>
          {invoices.map((inv) => (
            <Link
              key={inv.id}
              to={`/invoice/${inv.id}`}
              target="_blank"
              className="flex items-center justify-between gap-3 text-sm hover:bg-paper-warm rounded-input px-2 py-1.5 -mx-2"
            >
              <span className="flex items-center gap-2 text-ink">
                <FileText size={15} className="text-muted" /> {inv.invoiceNumber} · {inv.description}
              </span>
              <span className="text-muted shrink-0">
                {formatAmount(inv.total, inv.currency)} · {formatShortDate(inv.issuedAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
