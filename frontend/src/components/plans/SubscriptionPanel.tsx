import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/Button";
import { formatShortDate } from "@/api/licenses";
import {
  cancelSubscription,
  formatAmount,
  getSubscription,
  openBillingPortal,
  resumeSubscription,
  startSubscription,
  type SubscriptionState,
} from "@/api/payments";
import { tr } from "@/i18n/tr";

// Full access that renews every month: start it, see when it renews, cancel
// (access stays to the end of the paid month) or take that back, and open
// Stripe's billing page to change the card. Shown on the Plans page.
export function SubscriptionPanel({ onChanged }: { onChanged?: () => void }) {
  const navigate = useNavigate();
  const [data, setData] = useState<SubscriptionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    getSubscription()
      .then(setData)
      .catch(() => setData(null));
  useEffect(() => {
    load();
  }, []);

  if (!data || (!data.subscription && !data.available)) return null;
  const s = data.subscription;

  async function run(action: () => Promise<unknown>, failText: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onChanged?.();
    } catch {
      setError(failText);
    } finally {
      setBusy(false);
    }
  }

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      const r = await startSubscription(data?.monthly?.currency);
      if (r.redirectUrl) {
        window.location.href = r.redirectUrl;
        return;
      }
      navigate(`/checkout/return?subscription=${r.subscriptionId}&test=1`);
    } catch {
      setError(tr("The subscription couldn't be started. Try again, or buy months above."));
      setBusy(false);
    }
  }

  async function manageBilling() {
    setBusy(true);
    setError(null);
    try {
      window.location.href = (await openBillingPortal()).url;
    } catch {
      setError(tr("The billing page couldn't be opened. Try again later."));
      setBusy(false);
    }
  }

  if (!s) {
    const m = data.monthly!;
    return (
      <div className="border border-rule rounded-input px-3.5 py-3 flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink flex items-center gap-2">
          <RefreshCw size={15} className="text-navy-deep" /> {tr("Or renew every month")}
        </p>
        <p className="text-xs text-muted">
          {tr("{{price}} a month, paid by card. Renews automatically; cancel any time and keep access to the end of the paid month.", {
            price: formatAmount(m.total, m.currency),
          })}
        </p>
        {error && <p className="text-xs text-error">{error}</p>}
        <Button variant="secondary" onClick={subscribe} disabled={busy}>
          {busy ? tr("Please wait…") : tr("Subscribe monthly")}
        </Button>
      </div>
    );
  }

  const date = (iso: string | null) => (iso ? formatShortDate(iso) : "—");
  return (
    <div className="border border-navy/40 bg-paper-warm rounded-input px-3.5 py-3 flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink flex items-center gap-2">
        <RefreshCw size={15} className="text-navy-deep" /> {tr("Monthly subscription")}
      </p>
      {s.status === "past_due" ? (
        <p className="text-sm text-error">
          {tr("This month's payment didn't go through. Update your card by {{date}} to keep Full access.", { date: date(s.graceUntil) })}
        </p>
      ) : s.cancelAtPeriodEnd ? (
        <p className="text-sm text-ink">{tr("Cancelled. You keep Full access until {{date}} and won't be charged again.", { date: date(s.currentPeriodEnd) })}</p>
      ) : s.status === "trialing" ? (
        <p className="text-sm text-ink">
          {tr("First payment of {{price}} on {{date}}, when your current months end.", { price: formatAmount(s.monthlyTotal, s.currency), date: date(s.currentPeriodEnd) })}
        </p>
      ) : (
        <p className="text-sm text-ink">{tr("Renews on {{date}} for {{price}}.", { date: date(s.currentPeriodEnd), price: formatAmount(s.monthlyTotal, s.currency) })}</p>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {s.cancelAtPeriodEnd ? (
          <Button variant="secondary" onClick={() => run(() => resumeSubscription(s.id), tr("Renewal couldn't be turned back on. Try again."))} disabled={busy}>
            {tr("Keep renewing")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              if (window.confirm(tr("Cancel your monthly subscription? You keep Full access until {{date}}.", { date: date(s.currentPeriodEnd) })))
                run(() => cancelSubscription(s.id), tr("The subscription couldn't be cancelled. Try again."));
            }}
            disabled={busy}
          >
            {tr("Cancel subscription")}
          </Button>
        )}
        {s.canManageBilling && (
          <Button variant="secondary" onClick={manageBilling} disabled={busy}>
            {tr("Manage billing")}
          </Button>
        )}
      </div>
      {s.canManageBilling && <p className="text-xs text-muted">{tr("Manage billing: change your card, see your payments and download receipts.")}</p>}
    </div>
  );
}
