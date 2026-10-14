import { createHmac, timingSafeEqual } from "node:crypto";

// Payment provider adapters over plain REST (no SDK dependency). Each is
// switched on only when its keys are present in the environment.

export type ProviderName = "stripe" | "razorpay" | "test" | "invoice";

export const PAYMENT_CONFIG = {
  priceUsdCents: 10000,
  inrPerUsd: Number(process.env.INR_PER_USD ?? 84),
  gstRate: 18,
  stripeKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  seller: {
    name: process.env.SELLER_NAME ?? "Edstellar",
    address: process.env.SELLER_ADDRESS ?? "",
    taxId: process.env.SELLER_GSTIN ?? "",
    email: process.env.SELLER_EMAIL ?? "",
  },
};

export function stripeEnabled(): boolean {
  return PAYMENT_CONFIG.stripeKey.length > 0;
}

export function razorpayEnabled(): boolean {
  return PAYMENT_CONFIG.razorpayKeyId.length > 0 && PAYMENT_CONFIG.razorpayKeySecret.length > 0;
}

// Test checkout exists so the flow is usable before real keys are added. It
// is never available in production, and never when a real provider is set up.
export function testModeEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.PAYMENTS_TEST_MODE === "true") return true;
  return !stripeEnabled() && !razorpayEnabled();
}

// India pays in INR via Razorpay (UPI, Indian cards, GST invoice); everyone
// else in USD via Stripe. Falls back to whichever provider is configured.
export function chooseProvider(billingCountry: string | null): { provider: ProviderName; currency: "INR" | "USD" } | null {
  const india = billingCountry === "IN";
  if (india && razorpayEnabled()) return { provider: "razorpay", currency: "INR" };
  if (!india && stripeEnabled()) return { provider: "stripe", currency: "USD" };
  if (stripeEnabled()) return { provider: "stripe", currency: india ? "INR" : "USD" };
  if (razorpayEnabled()) return { provider: "razorpay", currency: india ? "INR" : "USD" };
  if (testModeEnabled()) return { provider: "test", currency: india ? "INR" : "USD" };
  return null;
}

// ---- Stripe Checkout ----

async function stripeRequest(method: "GET" | "POST", path: string, form?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAYMENT_CONFIG.stripeKey}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`stripe_error: ${JSON.stringify(json.error ?? json)}`);
  return json;
}

export async function stripeCreateCheckout(args: {
  orderId: string;
  currency: string;
  productName: string;
  unitAmount: number;
  quantity: number;
  taxLabel: string | null;
  taxAmount: number;
  customerEmail: string | null;
  returnPath: string;
}): Promise<{ sessionId: string; url: string }> {
  const ret = `${PAYMENT_CONFIG.frontendUrl}${args.returnPath}?order=${args.orderId}`;
  const form: Record<string, string> = {
    mode: "payment",
    success_url: `${ret}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${ret}&cancelled=1`,
    client_reference_id: args.orderId,
    "metadata[order_id]": args.orderId,
    "line_items[0][quantity]": String(args.quantity),
    "line_items[0][price_data][currency]": args.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(args.unitAmount),
    "line_items[0][price_data][product_data][name]": args.productName,
  };
  if (args.taxAmount > 0 && args.taxLabel) {
    form["line_items[1][quantity]"] = "1";
    form["line_items[1][price_data][currency]"] = args.currency.toLowerCase();
    form["line_items[1][price_data][unit_amount]"] = String(args.taxAmount);
    form["line_items[1][price_data][product_data][name]"] = args.taxLabel;
  }
  if (args.customerEmail) form.customer_email = args.customerEmail;
  const session = await stripeRequest("POST", "/checkout/sessions", form);
  return { sessionId: String(session.id), url: String(session.url) };
}

export async function stripeSessionPaid(sessionId: string): Promise<{ paid: boolean; paymentId: string | null; orderId: string | null }> {
  const s = await stripeRequest("GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`);
  return {
    paid: s.payment_status === "paid",
    paymentId: (s.payment_intent as string) ?? null,
    orderId: ((s.metadata as Record<string, string>)?.order_id as string) ?? null,
  };
}

// Stripe-Signature: t=<ts>,v1=<hex hmac of `${t}.${rawBody}`>
export function stripeVerifyWebhook(rawBody: string, header: string | undefined): boolean {
  if (!header || !PAYMENT_CONFIG.stripeWebhookSecret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", PAYMENT_CONFIG.stripeWebhookSecret).update(`${t}.${rawBody}`).digest("hex");
  return safeEqual(expected, v1);
}

// ---- Razorpay Orders ----

export async function razorpayCreateOrder(args: { orderId: string; amount: number; currency: string }): Promise<string> {
  const auth = Buffer.from(`${PAYMENT_CONFIG.razorpayKeyId}:${PAYMENT_CONFIG.razorpayKeySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: args.amount, currency: args.currency, receipt: args.orderId.slice(0, 40), notes: { order_id: args.orderId } }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`razorpay_error: ${JSON.stringify(json.error ?? json)}`);
  return String(json.id);
}

// Checkout handler returns razorpay_signature = hmac(order_id|payment_id, key_secret).
export function razorpayVerifyPayment(providerOrderId: string, paymentId: string, signature: string): boolean {
  const expected = createHmac("sha256", PAYMENT_CONFIG.razorpayKeySecret).update(`${providerOrderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
