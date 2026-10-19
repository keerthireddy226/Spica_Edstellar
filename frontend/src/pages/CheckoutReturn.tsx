import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { cancelPaymentOrder, confirmPaymentOrder } from "@/api/payments";
import { ROUTES } from "@/constants/routes";

import { tr } from "@/i18n/tr";
// Every checkout ends here. The server — not this page — decides whether the
// payment really happened (Stripe session lookup / Razorpay signature / test
// mode), then adds the licenses and issues the invoice.
export function CheckoutReturn() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const orderId = params.get("order") ?? "";
  const cancelled = params.get("cancelled") === "1";
  const isTest = params.get("test") === "1";
  const [state, setState] = useState<"confirm-test" | "working" | "paid" | "failed" | "cancelled">(
    cancelled ? "cancelled" : isTest ? "confirm-test" : "working",
  );
  const [result, setResult] = useState<{ invoiceId: string; kind: string; quantity: number } | null>(null);
  const ran = useRef(false);

  async function confirm() {
    setState("working");
    const body: Record<string, string> = {};
    for (const key of ["razorpay_order_id", "razorpay_payment_id", "razorpay_signature"]) {
      const v = params.get(key);
      if (v) body[key] = v;
    }
    try {
      const r = await confirmPaymentOrder(orderId, body);
      setResult(r);
      setState("paid");
    } catch (err) {
      setState(err instanceof ApiError && err.message === "payment_not_verified" ? "failed" : "failed");
    }
  }

  useEffect(() => {
    if (ran.current || !orderId) return;
    ran.current = true;
    if (cancelled) {
      cancelPaymentOrder(orderId).catch(() => {});
    } else if (!isTest) {
      confirm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const backTo = user?.role === "org_admin" ? ROUTES.ORG_ADMIN_LICENSES : ROUTES.PROFILE;
  const backLabel = user?.role === "org_admin" ? tr("Go to Licenses") : tr("Go to your profile");

  return (
    <div className="app-surface min-h-screen flex items-center justify-center px-4 py-10">
      <div className="bg-surface border border-rule rounded-card shadow-sm p-8 max-w-md w-full flex flex-col items-center text-center gap-4">
        {state === "confirm-test" && (
          <>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-warning/15 text-navy-deep">{tr("Test mode — no real charge")}</span>
            <h1 className="font-display font-bold text-xl text-ink">{tr("Simulate payment")}</h1>
            <p className="text-sm text-muted">
              {tr("No payment provider keys are configured yet, so this checkout is simulated. Real payments go through Razorpay (India) or Stripe once keys are added.")}</p>
            <div className="flex gap-3 w-full">
              <Button onClick={confirm} className="flex-1">
                {tr("Simulate successful payment")}</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  cancelPaymentOrder(orderId).catch(() => {});
                  setState("cancelled");
                }}
              >
                {tr("Cancel")}</Button>
            </div>
          </>
        )}
        {state === "working" && (
          <>
            <Loader2 size={36} className="text-navy animate-spin" />
            <p className="text-sm text-muted">{tr("Confirming your payment…")}</p>
          </>
        )}
        {state === "paid" && result && (
          <>
            <CheckCircle2 size={44} className="text-success" />
            <h1 className="font-display font-bold text-xl text-ink">{tr("Payment successful")}</h1>
            <p className="text-sm text-muted">
              {result.kind === "individual_plan"
                ? result.quantity === 1
                  ? tr("1 month of full access added to your account.")
                  : tr("{{n}} months of full access added to your account.", { n: result.quantity })
                : result.quantity === 1
                  ? tr("1 license added to your pool — assign it from the Licenses page.")
                  : tr("{{n}} licenses added to your pool — assign them from the Licenses page.", { n: result.quantity })}
            </p>
            <div className="flex gap-3 w-full">
              <Link to={backTo} className="flex-1">
                <Button className="w-full">{backLabel}</Button>
              </Link>
              <Link to={`/invoice/${result.invoiceId}`} target="_blank">
                <Button variant="secondary">{tr("View invoice")}</Button>
              </Link>
            </div>
          </>
        )}
        {(state === "failed" || state === "cancelled") && (
          <>
            <XCircle size={44} className={state === "failed" ? "text-error" : "text-muted"} />
            <h1 className="font-display font-bold text-xl text-ink">{state === "failed" ? tr("Payment not confirmed") : tr("Checkout cancelled")}</h1>
            <p className="text-sm text-muted">
              {state === "failed"
                ? tr("We couldn't verify this payment. If money left your account, it will be matched automatically or refunded — contact support with your order reference.")
                : tr("No payment was taken.")}
            </p>
            {state === "failed" && <p className="text-xs text-muted font-mono">{tr("Order {{slice}}", { slice: orderId.slice(0, 8) })}</p>}
            <Link to={backTo}>
              <Button variant="secondary">{backLabel}</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
