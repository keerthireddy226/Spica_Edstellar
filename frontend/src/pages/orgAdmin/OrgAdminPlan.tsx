import { useState } from "react";
import { Check, Clock, Gem, Minus, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/Button";
import { BuyLicensesModal } from "@/components/licenses/BuyLicensesModal";
import { refreshPlan, usePlan } from "@/components/plans/usePlan";
import { formatUsdCents, sendEnterpriseInquiry, TIER_LABELS, type PlanTier } from "@/api/plans";
import { formatShortDate } from "@/api/licenses";

const TIERS: PlanTier[] = ["starter", "business", "enterprise"];
const TIER_BLURB: Record<PlanTier, string> = {
  starter: "Small teams and pilots",
  business: "Growing companies and universities",
  enterprise: "Large or regulated organizations",
};

function limitText(max: number | null): string {
  return max === null ? "Unlimited" : `Up to ${max}`;
}

function EnterpriseInquiry() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function send() {
    if (!message.trim()) return;
    setState("sending");
    try {
      await sendEnterpriseInquiry(message.trim());
      setState("sent");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return <p className="text-sm text-success">Sent. Your Edstellar contact will get back to you.</p>;
  }
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="w-full">
        Talk to us
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        placeholder="How many learners, which features you need (SSO, API…), and your timeline."
        className="w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
      />
      {state === "error" && <p className="text-xs text-error">Couldn't send. Please try again.</p>}
      <Button onClick={send} disabled={state === "sending" || !message.trim()} className="flex items-center justify-center gap-2">
        <Send size={14} /> {state === "sending" ? "Sending…" : "Send"}
      </Button>
    </div>
  );
}

export function OrgAdminPlan() {
  const plan = usePlan();
  const [showBuy, setShowBuy] = useState(false);

  if (!plan) {
    return <p className="text-sm text-muted">Loading your plan…</p>;
  }

  const pilotDaysLeft = plan.pilotEndsAt ? Math.max(0, Math.ceil((new Date(plan.pilotEndsAt).getTime() - Date.now()) / 86400000)) : null;
  // Each feature row lists which tiers include it, from the catalog.
  const featureRows = plan.features;

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Plan</h1>
        <p className="text-sm text-muted mt-1">
          Every learner gets the same Spica on every plan. Plans set your price per license and the tools for managing at scale.
        </p>
      </div>

      {plan.pilotEndsAt && (
        <div className="flex items-start gap-3 rounded-card border border-warning/40 bg-warning/10 px-5 py-4">
          <Clock size={20} className="text-warning mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-ink">
              Pilot — {pilotDaysLeft === 0 ? "ends today" : `${pilotDaysLeft} day${pilotDaysLeft === 1 ? "" : "s"} left`}
            </p>
            <p className="text-sm text-muted">
              Your pilot licenses lapse on {formatShortDate(plan.pilotEndsAt)}. Buy licenses before then so learners keep their access.
            </p>
          </div>
          <Button onClick={() => setShowBuy(true)}>Buy licenses</Button>
        </div>
      )}

      <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="h-12 w-12 rounded-2xl bg-navy/10 text-navy flex items-center justify-center">
              <Gem size={22} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Current plan</p>
              <p className="font-display font-bold text-xl text-ink">{plan.tierLabel}</p>
              <p className="text-xs text-muted">{plan.support}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your price</p>
            <p className="font-display font-bold text-xl text-ink">
              {plan.customPriceCents !== null ? formatUsdCents(plan.customPriceCents) : `from ${formatUsdCents(Math.min(...plan.bands.map((b) => b.unitPriceCents)))}`}
              <span className="text-sm font-normal text-muted"> / license</span>
            </p>
            {plan.customPriceCents !== null && <p className="text-xs text-muted">Negotiated price</p>}
            {plan.educationDiscountPercent > 0 && plan.customPriceCents === null && (
              <p className="text-xs text-success">Includes {plan.educationDiscountPercent}% education discount</p>
            )}
          </div>
        </div>

        {(plan.contract || plan.accountManager) && (
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm rounded-input bg-paper-warm px-4 py-3">
            {plan.contract?.end && (
              <span>
                <span className="text-muted">Contract</span>{" "}
                <span className="text-ink font-medium">
                  {plan.contract.start ? `${formatShortDate(plan.contract.start)} – ` : "until "}
                  {formatShortDate(plan.contract.end)}
                </span>
              </span>
            )}
            {plan.accountManager && (
              <span>
                <span className="text-muted">Your account manager</span>{" "}
                <a href={`mailto:${plan.accountManager.email}`} className="text-navy font-medium hover:underline">
                  {plan.accountManager.name}
                </a>
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {plan.limits.map((l) => {
            const pct = l.max === null ? 0 : Math.min(100, Math.round((l.used / l.max) * 100));
            return (
              <div key={l.key} className="rounded-input border border-rule px-4 py-3">
                <div className="flex justify-between text-sm">
                  <span className="text-ink font-medium capitalize">{l.key}</span>
                  <span className="text-muted">
                    {l.used} {l.max === null ? "· unlimited" : `of ${l.max}`}
                  </span>
                </div>
                {l.max !== null && (
                  <div className="h-1.5 rounded-pill bg-rule mt-2 overflow-hidden">
                    <div className={`h-full ${pct >= 100 ? "bg-error" : pct >= 80 ? "bg-warning" : "bg-navy"}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {plan.customPriceCents === null && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Price per license-month on your plan</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {plan.bands.map((b) => (
                <div key={b.minQuantity} className="rounded-input bg-paper-warm px-3.5 py-2.5">
                  <p className="text-sm text-muted">
                    {b.maxQuantity === null ? `${b.minQuantity}+ licenses` : `${b.minQuantity}–${b.maxQuantity} licenses`}
                  </p>
                  <p className="font-semibold text-ink">{formatUsdCents(b.unitPriceCents)}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted mt-2">Priced per purchase. Licenses stay valid for 12 months from purchase.</p>
          </div>
        )}

        {plan.tier === "starter" && (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-input bg-navy/5 px-4 py-3">
            <p className="text-sm text-ink">
              <Sparkles size={15} className="inline text-navy mr-1.5 -mt-0.5" />
              Buy {plan.businessQualifyingQuantity} or more licenses at once and your organization moves to Business automatically.
            </p>
            <Button onClick={() => setShowBuy(true)}>Buy licenses</Button>
          </div>
        )}
      </div>

      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-rule">
              <th className="text-left px-5 py-4 font-semibold text-muted text-xs uppercase tracking-wide w-2/5">Compare plans</th>
              {plan.catalog.map((c) => (
                <th key={c.tier} className={`px-4 py-4 text-left align-top ${c.tier === plan.tier ? "bg-navy/5" : ""}`}>
                  <p className="font-display font-bold text-base text-ink">
                    {c.label}
                    {c.tier === plan.tier && <span className="ml-2 text-[11px] font-semibold text-navy uppercase">Current</span>}
                  </p>
                  <p className="text-xs text-muted font-normal">{TIER_BLURB[c.tier]}</p>
                  <p className="text-xs text-ink font-normal mt-1">
                    {c.tier === "enterprise" ? "Custom pricing" : `from ${formatUsdCents(c.fromPriceCents)} / license`}
                  </p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-rule">
              <td className="px-5 py-3 text-ink">Managers</td>
              {plan.catalog.map((c) => (
                <td key={c.tier} className={`px-4 py-3 ${c.tier === plan.tier ? "bg-navy/5" : ""}`}>
                  {limitText(c.limits.managers)}
                </td>
              ))}
            </tr>
            <tr className="border-b border-rule">
              <td className="px-5 py-3 text-ink">Batches</td>
              {plan.catalog.map((c) => (
                <td key={c.tier} className={`px-4 py-3 ${c.tier === plan.tier ? "bg-navy/5" : ""}`}>
                  {limitText(c.limits.batches)}
                </td>
              ))}
            </tr>
            {featureRows.map((f) => (
              <tr key={f.key} className="border-b border-rule last:border-0">
                <td className="px-5 py-3">
                  <p className="text-ink">
                    {f.label}
                    {!f.available && <span className="ml-2 text-[11px] font-semibold text-muted uppercase">Coming soon</span>}
                  </p>
                  <p className="text-xs text-muted">{f.description}</p>
                </td>
                {plan.catalog.map((c) => (
                  <td key={c.tier} className={`px-4 py-3 ${c.tier === plan.tier ? "bg-navy/5" : ""}`}>
                    {c.features.includes(f.key) ? <Check size={16} className="text-success" /> : <Minus size={16} className="text-rule-strong" />}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-rule">
              <td className="px-5 py-3 text-ink">Support</td>
              {plan.catalog.map((c) => (
                <td key={c.tier} className={`px-4 py-3 text-xs ${c.tier === plan.tier ? "bg-navy/5" : ""}`}>
                  {c.support}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-5 py-4" />
              {TIERS.map((tier) => (
                <td key={tier} className={`px-4 py-4 align-top ${tier === plan.tier ? "bg-navy/5" : ""}`}>
                  {tier === plan.tier ? (
                    <span className="text-xs text-muted">Your plan</span>
                  ) : tier === "enterprise" ? (
                    <EnterpriseInquiry />
                  ) : tier === "business" && plan.tier === "starter" ? (
                    <Button onClick={() => setShowBuy(true)} className="w-full">
                      Buy {plan.businessQualifyingQuantity}+
                    </Button>
                  ) : (
                    <span className="text-xs text-muted">Included in {TIER_LABELS[plan.tier]}</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {showBuy && (
        <BuyLicensesModal
          onClose={() => {
            setShowBuy(false);
            refreshPlan();
          }}
        />
      )}
    </div>
  );
}
