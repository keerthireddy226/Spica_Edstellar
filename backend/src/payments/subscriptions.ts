import { pool } from "../db.js";
import { notify } from "../notifications/service.js";
import { learnerAccess } from "../licenses/service.js";
import { accessCache } from "../licenses/accessCache.js";
import { PAYMENT_CONFIG, stripeRequest, testModeEnabled } from "./providers.js";
import { planQuote } from "./products.js";
import { createOrder, fulfillOrder, PaymentError, type Buyer, type Quote } from "./service.js";

// Full access that renews every month until cancelled (launch plan 6.4-6.7).
// Card payments through Stripe only; India's Razorpay keeps the prepaid
// 1, 3 and 6 month plans. Each paid month becomes an ordinary order and
// invoice, and adds one month of access, exactly like buying one month.
//  - A learner who still has paid months is first charged when they run out.
//  - A cancelled subscription keeps access to the end of the paid month.
//  - A failed renewal: Stripe retries and emails; access continues for
//    GRACE_DAYS, then stops until the payment goes through.

export const SUBSCRIPTION_GRACE_DAYS = 7;
const LIVE = ["trialing", "active", "past_due"];

export interface SubscriptionView {
  id: string;
  provider: "stripe" | "test";
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  currency: string;
  monthlyTotal: number;
  canManageBilling: boolean;
}

function view(r: Record<string, any>): SubscriptionView {
  return {
    id: r.id,
    provider: r.provider,
    status: r.status,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end).toISOString() : null,
    graceUntil: r.grace_until ? new Date(r.grace_until).toISOString() : null,
    currency: r.currency,
    monthlyTotal: Number(r.unit_amount) + Number(r.tax_amount),
    canManageBilling: r.provider === "stripe" && !!r.provider_customer_id,
  };
}

export async function liveSubscription(userId: string): Promise<SubscriptionView | null> {
  const r = await pool.query(`SELECT * FROM subscriptions WHERE user_id = $1 AND status = ANY($2::text[]) ORDER BY created_at DESC LIMIT 1`, [userId, LIVE]);
  return r.rows[0] ? view(r.rows[0]) : null;
}

// After a failed renewal, access continues until the grace time.
export async function inSubscriptionGrace(userId: string): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM subscriptions WHERE user_id = $1 AND status = 'past_due' AND grace_until > now() LIMIT 1`, [userId]);
  return (r.rowCount ?? 0) > 0;
}

// The monthly price in the buyer's currency, if it can renew there.
export async function subscriptionQuote(buyer: Buyer, currency?: string): Promise<Quote | null> {
  const q = await planQuote(buyer, 1, { currency });
  if (q.provider !== "stripe" && q.provider !== "test") return null;
  // No one-off credit on a subscription: every month costs the same.
  const taxAmount = Math.round((q.unitAmount * q.taxRate) / 100);
  return { ...q, credit: undefined, creditSources: undefined, subtotal: q.unitAmount, taxAmount, total: q.unitAmount + taxAmount };
}

// Starts a subscription. Stripe: returns the Checkout page to pay on. Test
// (development only): active at once.
export async function startSubscription(buyer: Buyer, currency?: string): Promise<{ subscriptionId: string; provider: "stripe" | "test"; redirectUrl?: string }> {
  if (await liveSubscription(buyer.userId)) throw new PaymentError("already_subscribed");
  const q = await subscriptionQuote(buyer, currency);
  if (!q) throw new PaymentError("subscriptions_unavailable");
  // Paid months still to come: the first charge waits until they run out.
  const access = await learnerAccess(buyer.userId);
  const endsAt = access.accessEndsAt ? new Date(access.accessEndsAt) : null;
  const firstChargeAt = endsAt && endsAt.getTime() > Date.now() + 48 * 3_600_000 ? endsAt : null;
  // A checkout left unfinished doesn't block a new one.
  await pool.query(`DELETE FROM subscriptions WHERE user_id = $1 AND status = 'incomplete'`, [buyer.userId]);
  const id = (
    await pool.query(
      `INSERT INTO subscriptions (user_id, tenant_id, provider, currency, unit_amount, tax_rate, tax_amount) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [buyer.userId, buyer.tenantId, q.provider, q.currency, q.unitAmount, q.taxRate, q.taxAmount],
    )
  ).rows[0].id as string;

  if (q.provider === "test") {
    if (!testModeEnabled()) throw new PaymentError("subscriptions_unavailable");
    const periodEnd = new Date((firstChargeAt ?? new Date()).getTime());
    periodEnd.setMonth(periodEnd.getMonth() + (firstChargeAt ? 0 : 1));
    await pool.query(`UPDATE subscriptions SET status = $2, current_period_end = $3, updated_at = now() WHERE id = $1`, [id, firstChargeAt ? "trialing" : "active", periodEnd]);
    if (!firstChargeAt) await payRenewal(id, `test_${id}_${Date.now()}`, q.total, null);
    return { subscriptionId: id, provider: "test" };
  }

  const ret = `${PAYMENT_CONFIG.frontendUrl}/checkout/return?subscription=${id}`;
  const cur = q.currency.toLowerCase();
  const form: Record<string, string> = {
    mode: "subscription",
    success_url: `${ret}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${ret}&cancelled=1`,
    client_reference_id: id,
    "metadata[subscription_row]": id,
    "subscription_data[metadata][subscription_row]": id,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": cur,
    "line_items[0][price_data][unit_amount]": String(q.unitAmount),
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": "Spica Full access (renews monthly)",
  };
  if (q.taxAmount > 0 && q.taxLabel) {
    form["line_items[1][quantity]"] = "1";
    form["line_items[1][price_data][currency]"] = cur;
    form["line_items[1][price_data][unit_amount]"] = String(q.taxAmount);
    form["line_items[1][price_data][recurring][interval]"] = "month";
    form["line_items[1][price_data][product_data][name]"] = q.taxLabel;
  }
  if (firstChargeAt) form["subscription_data[trial_end]"] = String(Math.floor(firstChargeAt.getTime() / 1000));
  if (buyer.email) form.customer_email = buyer.email;
  const session = await stripeRequest("POST", "/checkout/sessions", form);
  return { subscriptionId: id, provider: "stripe", redirectUrl: String(session.url) };
}

// One paid month: an order and invoice, and a month of access. Runs once per
// provider invoice however often the provider reports it.
async function payRenewal(subscriptionRowId: string, providerInvoiceId: string, amountPaid: number, providerPaymentId: string | null): Promise<void> {
  const s = (await pool.query(`SELECT * FROM subscriptions WHERE id = $1`, [subscriptionRowId])).rows[0];
  if (!s) return;
  let orderId = (await pool.query(`SELECT id FROM payment_orders WHERE provider = $1 AND provider_order_id = $2`, [s.provider, providerInvoiceId])).rows[0]?.id as string | undefined;
  if (!orderId) {
    const u = (
      await pool.query(
        `SELECT u.email, u.first_name, u.last_name, p.country, p.city FROM users u LEFT JOIN participant_profiles p ON p.user_id = u.id WHERE u.id = $1`,
        [s.user_id],
      )
    ).rows[0];
    const buyer: Buyer = {
      tenantId: s.tenant_id,
      userId: s.user_id,
      kind: "individual_plan",
      plan: null,
      billingCountry: u?.country ?? null,
      email: u?.email ?? null,
      billTo: { name: [u?.first_name, u?.last_name].filter(Boolean).join(" ") || (u?.email ?? null), email: u?.email ?? null, address: u?.city ?? null, country: u?.country ?? null },
    };
    const tax = Math.min(Number(s.tax_amount), amountPaid);
    const q: Quote = {
      currency: s.currency,
      provider: s.provider,
      quantity: 1,
      unitAmount: amountPaid - tax,
      subtotal: amountPaid - tax,
      taxLabel: tax > 0 ? `GST ${Number(s.tax_rate)}%` : null,
      taxRate: tax > 0 ? Number(s.tax_rate) : 0,
      taxAmount: tax,
      total: amountPaid,
      billingCountry: buyer.billingCountry,
      listUnitAmount: Number(s.unit_amount),
      upgradesTo: null,
    };
    orderId = await createOrder(buyer, q);
    try {
      await pool.query(`UPDATE payment_orders SET subscription_id = $2, provider_order_id = $3 WHERE id = $1`, [orderId, s.id, providerInvoiceId]);
    } catch (err) {
      // The same invoice reported twice at once: the other one pays it.
      await pool.query(`DELETE FROM payment_orders WHERE id = $1 AND status = 'created'`, [orderId]);
      if ((err as { code?: string }).code === "23505") return;
      throw err;
    }
  }
  await fulfillOrder(orderId, providerPaymentId);
  await pool.query(`UPDATE subscriptions SET status = 'active', grace_until = NULL, updated_at = now() WHERE id = $1 AND status <> 'canceled'`, [s.id]);
  accessCache.delete(s.user_id);
}

async function renewalFailed(subscriptionRowId: string, providerInvoiceId: string): Promise<void> {
  const s = (
    await pool.query(
      `UPDATE subscriptions SET status = 'past_due', grace_until = coalesce(grace_until, now() + make_interval(days => $2)), updated_at = now()
       WHERE id = $1 AND status <> 'canceled' RETURNING user_id, grace_until`,
      [subscriptionRowId, SUBSCRIPTION_GRACE_DAYS],
    )
  ).rows[0];
  if (!s) return;
  accessCache.delete(s.user_id);
  await notify({
    userId: s.user_id,
    kind: "subscription_payment_failed",
    title: "Your Spica payment didn't go through",
    body: `We couldn't take this month's payment for Full access. Your access continues until ${new Date(s.grace_until).toISOString().slice(0, 10)}. Update your card on the Plans page (Manage billing) to keep it.`,
    link: "/plans",
    dedupeKey: `subscription_payment_failed:${providerInvoiceId}`,
    email: true,
  }).catch(() => {});
}

// Cancels at the end of the paid month (or takes the cancellation back).
export async function setCancelAtPeriodEnd(userId: string, subscriptionRowId: string, cancel: boolean): Promise<SubscriptionView> {
  const s = (await pool.query(`SELECT * FROM subscriptions WHERE id = $1 AND user_id = $2 AND status = ANY($3::text[])`, [subscriptionRowId, userId, LIVE])).rows[0];
  if (!s) throw new PaymentError("subscription_not_found");
  if (s.provider === "stripe") {
    if (!s.provider_subscription_id) throw new PaymentError("subscription_not_ready");
    await stripeRequest("POST", `/subscriptions/${encodeURIComponent(s.provider_subscription_id)}`, { cancel_at_period_end: cancel ? "true" : "false" });
  }
  const r = (await pool.query(`UPDATE subscriptions SET cancel_at_period_end = $2, updated_at = now() WHERE id = $1 RETURNING *`, [s.id, cancel])).rows[0];
  if (cancel) {
    const end = r.current_period_end ? new Date(r.current_period_end).toISOString().slice(0, 10) : null;
    await notify({
      userId,
      kind: "subscription_cancelled",
      title: "Your Full access subscription is cancelled",
      body: `${end ? `You keep Full access until ${end}. ` : ""}You won't be charged again. You can turn renewal back on from the Plans page before then.`,
      link: "/plans",
      dedupeKey: `subscription_cancelled:${s.id}:${Date.now() >> 16}`,
      email: true,
    }).catch(() => {});
  }
  return view(r);
}

// Stripe's own page to change the card, see payments and cancel.
export async function billingPortalUrl(userId: string): Promise<string> {
  const s = (
    await pool.query(
      `SELECT provider_customer_id FROM subscriptions WHERE user_id = $1 AND provider = 'stripe' AND provider_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [userId],
    )
  ).rows[0];
  if (!s) throw new PaymentError("no_billing_account");
  const portal = await stripeRequest("POST", "/billing_portal/sessions", { customer: s.provider_customer_id, return_url: `${PAYMENT_CONFIG.frontendUrl}/plans` });
  return String(portal.url);
}

// Development only: what Stripe's events do, to try the flow without Stripe.
export async function testRenewal(userId: string, subscriptionRowId: string, outcome: "paid" | "failed"): Promise<SubscriptionView> {
  if (!testModeEnabled()) throw new PaymentError("not_available");
  const s = (await pool.query(`SELECT * FROM subscriptions WHERE id = $1 AND user_id = $2 AND provider = 'test'`, [subscriptionRowId, userId])).rows[0];
  if (!s) throw new PaymentError("subscription_not_found");
  const invoiceId = `test_${s.id}_${Date.now()}`;
  if (outcome === "paid") {
    await payRenewal(s.id, invoiceId, Number(s.unit_amount) + Number(s.tax_amount), null);
    await pool.query(`UPDATE subscriptions SET current_period_end = coalesce(current_period_end, now()) + interval '1 month' WHERE id = $1`, [s.id]);
  } else {
    await renewalFailed(s.id, invoiceId);
  }
  return view((await pool.query(`SELECT * FROM subscriptions WHERE id = $1`, [s.id])).rows[0]);
}

// ---- Stripe events ----

const STRIPE_STATUS: Record<string, string> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  paused: "past_due",
};

async function rowFor(stripeSubscriptionId: string | null | undefined, rowId?: string | null): Promise<string | null> {
  if (stripeSubscriptionId) {
    const r = (await pool.query(`SELECT id FROM subscriptions WHERE provider_subscription_id = $1`, [stripeSubscriptionId])).rows[0];
    if (r) return r.id;
  }
  if (rowId && /^[0-9a-f-]{36}$/i.test(rowId)) {
    const r = (await pool.query(`SELECT id FROM subscriptions WHERE id = $1`, [rowId])).rows[0];
    if (r) {
      if (stripeSubscriptionId) await pool.query(`UPDATE subscriptions SET provider_subscription_id = $2 WHERE id = $1 AND provider_subscription_id IS NULL`, [r.id, stripeSubscriptionId]);
      return r.id;
    }
  }
  return null;
}

// The subscription an invoice belongs to (older and newer Stripe API shapes).
function invoiceSubscription(inv: Record<string, any>): string | null {
  return inv.subscription ?? inv.parent?.subscription_details?.subscription ?? inv.lines?.data?.[0]?.subscription ?? null;
}

function periodEnd(sub: Record<string, any>): Date | null {
  const t = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof t === "number" ? new Date(t * 1000) : null;
}

// Returns true when the event was a subscription event (handled here).
export async function handleStripeSubscriptionEvent(event: { type: string; data: { object: Record<string, any> } }): Promise<boolean> {
  const o = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      if (o.mode !== "subscription") return false;
      const id = await rowFor(o.subscription, o.client_reference_id ?? o.metadata?.subscription_row);
      if (id) {
        await pool.query(
          `UPDATE subscriptions SET provider_subscription_id = coalesce(provider_subscription_id, $2), provider_customer_id = $3,
             status = CASE WHEN status = 'incomplete' THEN 'active' ELSE status END, updated_at = now() WHERE id = $1`,
          [id, o.subscription ?? null, o.customer ?? null],
        );
      }
      return true;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const id = await rowFor(o.id, o.metadata?.subscription_row);
      if (!id) return true;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : (STRIPE_STATUS[o.status] ?? "active");
      const r = (
        await pool.query(
          `UPDATE subscriptions SET status = $2, cancel_at_period_end = $3, current_period_end = coalesce($4, current_period_end),
             provider_customer_id = coalesce(provider_customer_id, $5),
             canceled_at = CASE WHEN $2 = 'canceled' THEN coalesce(canceled_at, now()) ELSE NULL END,
             grace_until = CASE WHEN $2 IN ('active', 'trialing') THEN NULL ELSE grace_until END, updated_at = now()
           WHERE id = $1 RETURNING user_id`,
          [id, status, !!o.cancel_at_period_end, periodEnd(o), o.customer ?? null],
        )
      ).rows[0];
      if (r) accessCache.delete(r.user_id);
      return true;
    }
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const sub = invoiceSubscription(o);
      if (!sub) return false;
      const id = await rowFor(sub, o.subscription_details?.metadata?.subscription_row ?? o.parent?.subscription_details?.metadata?.subscription_row);
      // A free first invoice (the paid months still running) adds nothing.
      if (id && Number(o.amount_paid) > 0) await payRenewal(id, String(o.id), Number(o.amount_paid), (o.payment_intent as string) ?? null);
      return true;
    }
    case "invoice.payment_failed": {
      const sub = invoiceSubscription(o);
      if (!sub) return false;
      const id = await rowFor(sub);
      if (id) await renewalFailed(id, String(o.id));
      return true;
    }
    default:
      return false;
  }
}
