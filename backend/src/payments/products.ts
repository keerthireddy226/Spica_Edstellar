// Buying a product online: Full access, preparation + assessment for one test,
// an assessment, or a level test. Each product has a price per currency;
// India pays in INR (GST added), a few other markets in their own currency,
// everyone else in USD. Upgrading to Full access credits the unused part of
// a preparation purchase, once.
import { pool } from "../db.js";
import { PAYMENT_CONFIG, chooseProvider, razorpayEnabled, stripeEnabled, testModeEnabled, type ProviderName } from "./providers.js";
import { INDIVIDUAL_PLAN_MONTHS, PaymentError, type Buyer, type Quote } from "./service.js";

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

const EURO_COUNTRIES = new Set(["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"]);

// The currency a country pays in by default.
export function currencyFor(country: string | null | undefined): Currency {
  const c = (country ?? "").toUpperCase();
  if (c === "IN") return "INR";
  if (c === "GB") return "GBP";
  if (c === "AE") return "AED";
  if (c === "SG") return "SGD";
  if (EURO_COUNTRIES.has(c)) return "EUR";
  return "USD";
}

// INR goes through Razorpay where it's set up; every other currency through Stripe.
function providerFor(currency: Currency): ProviderName | null {
  if (currency === "INR" && razorpayEnabled()) return "razorpay";
  if (stripeEnabled()) return "stripe";
  if (razorpayEnabled() && currency === "INR") return "razorpay";
  if (testModeEnabled()) return "test";
  return null;
}

export interface ProductQuote {
  productId: string;
  productName: string;
  kind: string;
  testTypeId: string | null;
  level: string | null;
  currency: Currency;
  provider: ProviderName;
  // The product's price, the upgrade credit, and what's charged.
  price: number;
  credit: number;
  // A level test's discount: half price to retake a level not passed, 25% off the next level after a pass.
  discount: number;
  discountReason: "level_retake" | "next_level" | null;
  subtotal: number;
  taxLabel: string | null;
  taxRate: number;
  taxAmount: number;
  total: number;
  durationDays: number;
  attempts: number;
  // A certificate extra: the final assessment certificate it's for.
  certificateId: string | null;
}

// One paid preparation the buyer can still be credited for, valued in the
// currency being paid: what they paid if it was the same currency, else that
// preparation's price in this currency. `usedShare` is the part of its value
// earlier paid orders already took as credit (1 = all of it).
export interface PrepCredit {
  entitlementId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  value: number;
  usedShare: number;
}

export interface CreditSource {
  entitlementId: string;
  // The part of the preparation's value this order takes (0 to 1).
  share: number;
}

// Pure: the credit for the unused time of these preparations, at most `cap`,
// and which preparation each part of it comes from. A preparation's credit
// is its value times the share of its time left, less what earlier orders
// already took, so the same credit can't be used twice.
export function creditFromPreps(rows: PrepCredit[], cap: number, now = Date.now()): { credit: number; sources: CreditSource[] } {
  let credit = 0;
  const sources: CreditSource[] = [];
  for (const r of rows) {
    if (credit >= cap || r.value <= 0) continue;
    const span = new Date(r.endsAt).getTime() - new Date(r.startsAt).getTime();
    if (span <= 0) continue;
    const left = Math.max(0, Math.min(span, new Date(r.endsAt).getTime() - now));
    const available = Math.max(0, Math.round(r.value * (left / span - r.usedShare)));
    const take = Math.min(available, cap - credit);
    if (take <= 0) continue;
    credit += take;
    sources.push({ entitlementId: r.entitlementId, share: take / r.value });
  }
  return { credit, sources };
}

// The buyer's paid preparations still running, valued in this currency (see PrepCredit).
async function prepCredits(userId: string, currency: Currency): Promise<PrepCredit[]> {
  const rows = (
    await pool.query(
      `SELECT e.id, e.starts_at, e.ends_at, o.currency, o.subtotal, pp.amount AS price_here,
         coalesce((
           SELECT sum((s->>'share')::numeric) FROM payment_orders u, jsonb_array_elements(coalesce(u.credit_sources, '[]'::jsonb)) s
           WHERE u.buyer_id = $1 AND u.status = 'paid' AND s->>'entitlementId' = e.id::text
         ), 0) AS used_share
       FROM entitlements e JOIN products p ON p.id = e.product_id JOIN payment_orders o ON o.id = e.order_id
       LEFT JOIN product_prices pp ON pp.product_id = e.product_id AND pp.currency = $2
       WHERE e.user_id = $1 AND p.kind = 'prep' AND e.revoked_at IS NULL AND e.ends_at > now() AND o.status = 'paid'
       ORDER BY e.starts_at`,
      [userId, currency],
    )
  ).rows;
  return rows
    .map((r) => ({
      entitlementId: r.id as string,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      // Paid in another currency: its price in this one (nothing when it has none).
      value: r.currency === currency ? Number(r.subtotal) : Number(r.price_here ?? 0),
      usedShare: Number(r.used_share),
    }))
    .filter((r) => r.value > 0);
}

// Unused time of the buyer's paid preparation purchases, in this currency, as
// credit (at most `cap`), less what earlier orders already used.
export async function upgradeCredit(userId: string, currency: Currency, cap: number): Promise<{ credit: number; sources: CreditSource[] }> {
  return creditFromPreps(await prepCredits(userId, currency), cap);
}

// Full access by the month for an individual (the Plans page). Its price is
// the Full access row in product_prices, the same one the price list and
// Spica staff's Products page show, in the buyer's currency (or the one they
// chose); PAYMENT_CONFIG only fills in when a currency has no row. Unused
// preparation counts towards it.
export async function planQuote(buyer: Buyer, months: number, opts: { currency?: string } = {}): Promise<Quote> {
  if (!INDIVIDUAL_PLAN_MONTHS.includes(months as 1 | 3 | 6)) throw new PaymentError("invalid_quantity");
  let currency: Currency = CURRENCIES.includes(opts.currency as Currency) ? (opts.currency as Currency) : currencyFor(buyer.billingCountry);
  let provider = providerFor(currency);
  if (!provider) {
    // No provider takes this currency: the older INR/USD choice.
    const choice = chooseProvider(buyer.billingCountry);
    if (!choice) throw new PaymentError("no_provider");
    currency = choice.currency;
    provider = choice.provider;
  }
  const full = async (c: Currency) =>
    (
      await pool.query(
        `SELECT pp.amount FROM products p JOIN product_prices pp ON pp.product_id = p.id AND pp.currency = $1
         WHERE p.kind = 'full' AND p.active ORDER BY p.sort_order LIMIT 1`,
        [c],
      )
    ).rows[0]?.amount as number | undefined;
  let unitAmount = await full(currency);
  if (unitAmount === undefined && (currency === "INR" || currency === "USD")) {
    unitAmount = currency === "INR" ? Math.round((PAYMENT_CONFIG.priceUsdCents / 100) * PAYMENT_CONFIG.inrPerUsd * 100) : PAYMENT_CONFIG.priceUsdCents;
  }
  if (unitAmount === undefined) {
    // No price in this currency: USD, as for every other product.
    currency = "USD";
    provider = providerFor("USD") ?? provider;
    unitAmount = (await full("USD")) ?? PAYMENT_CONFIG.priceUsdCents;
  }
  unitAmount = Number(unitAmount);
  const gross = unitAmount * months;
  // GST applies to sales billed in India.
  const taxRate = buyer.billingCountry === "IN" && currency === "INR" ? PAYMENT_CONFIG.gstRate : 0;
  const { credit, sources } = await upgradeCredit(buyer.userId, currency, gross);
  const subtotal = gross - credit;
  const taxAmount = Math.round((subtotal * taxRate) / 100);
  return {
    currency,
    provider,
    quantity: months,
    unitAmount,
    ...(credit > 0 ? { credit, creditSources: sources } : {}),
    subtotal,
    taxLabel: taxRate > 0 ? `GST ${taxRate}%` : null,
    taxRate,
    taxAmount,
    total: subtotal + taxAmount,
    billingCountry: buyer.billingCountry,
    listUnitAmount: unitAmount,
    upgradesTo: null,
  };
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
export const LEVEL_RETAKE_OFF = 50;
export const NEXT_LEVEL_OFF = 25;

// Pure: the discount on a level test at `level`, from the buyer's finished level
// tests (newest first): the last one at this level not passed, or the level
// below passed.
export function levelDiscountOf(level: string, results: { level: string; passed: boolean }[]): { percent: number; reason: "level_retake" | "next_level" } | null {
  const same = results.find((r) => r.level === level);
  if (same && !same.passed) return { percent: LEVEL_RETAKE_OFF, reason: "level_retake" };
  const below = LEVELS[LEVELS.indexOf(level) - 1];
  if (!same && below && results.some((r) => r.level === below && r.passed)) return { percent: NEXT_LEVEL_OFF, reason: "next_level" };
  return null;
}

async function levelResults(userId: string): Promise<{ level: string; passed: boolean }[]> {
  return (
    await pool.query(
      `SELECT composition->>'levelTest' AS level, (result->'levelTest'->>'passed')::boolean AS passed FROM sessions
       WHERE user_id = $1 AND delivery_mode = 'certified' AND completed_at IS NOT NULL AND result->'levelTest'->>'passed' IS NOT NULL
       ORDER BY completed_at DESC`,
      [userId],
    )
  ).rows;
}

export async function productQuote(buyer: Buyer, productId: string, opts: { currency?: string; level?: string; certificateId?: string } = {}): Promise<ProductQuote> {
  // Full access is bought by the month from the Plans page (planQuote); the
  // final assessment comes with it.
  const p = (await pool.query(`SELECT * FROM products WHERE id = $1 AND active AND kind NOT IN ('final', 'full')`, [productId])).rows[0];
  if (!p) throw new PaymentError("invalid_quantity");
  // A certificate extra is for one of the buyer's own final assessment certificates.
  if (String(p.kind).startsWith("cert_")) {
    const c = opts.certificateId
      ? (await pool.query(`SELECT valid_until FROM certificates WHERE id = $1 AND user_id = $2 AND kind = 'result' AND revoked_at IS NULL`, [opts.certificateId, buyer.userId])).rows[0]
      : null;
    if (!c || (p.kind !== "cert_print" && c.valid_until === null)) throw new PaymentError("invalid_quantity");
  }
  if ((p.kind === "level" || p.kind === "pack") && !["A1", "A2", "B1", "B2", "C1", "C2"].includes(opts.level ?? "")) throw new PaymentError("invalid_quantity");
  const currency: Currency = CURRENCIES.includes(opts.currency as Currency) ? (opts.currency as Currency) : currencyFor(buyer.billingCountry);
  const priced = (await pool.query(`SELECT amount FROM product_prices WHERE product_id = $1 AND currency = $2`, [productId, currency])).rows[0];
  // No price in this currency: USD.
  const finalCurrency: Currency = priced ? currency : "USD";
  const price = priced
    ? Number(priced.amount)
    : Number((await pool.query(`SELECT amount FROM product_prices WHERE product_id = $1 AND currency = 'USD'`, [productId])).rows[0]?.amount ?? 0);
  const provider = providerFor(finalCurrency);
  if (!provider) throw new PaymentError("no_provider");
  const off = p.kind === "level" ? levelDiscountOf(opts.level!, await levelResults(buyer.userId)) : null;
  const discount = off ? Math.round((price * off.percent) / 100) : 0;
  const subtotal = price - discount;
  // GST applies to sales billed in India.
  const taxRate = buyer.billingCountry === "IN" && finalCurrency === "INR" ? PAYMENT_CONFIG.gstRate : 0;
  const taxAmount = Math.round((subtotal * taxRate) / 100);
  return {
    productId: p.id,
    productName: p.name,
    kind: p.kind,
    testTypeId: p.test_type_id,
    level: p.kind === "level" || p.kind === "pack" ? (opts.level ?? null) : null,
    currency: finalCurrency,
    provider,
    price,
    // Only Full access takes upgrade credit, and it isn't sold here.
    credit: 0,
    discount,
    discountReason: off?.reason ?? null,
    subtotal,
    taxLabel: taxRate > 0 ? `GST ${taxRate}%` : null,
    taxRate,
    taxAmount,
    total: subtotal + taxAmount,
    durationDays: p.duration_days,
    attempts: p.attempts,
    certificateId: String(p.kind).startsWith("cert_") ? opts.certificateId! : null,
  };
}

export async function createProductOrder(buyer: Buyer, q: ProductQuote, shipping?: Record<string, string> | null): Promise<string> {
  const r = await pool.query(
    `INSERT INTO payment_orders (tenant_id, buyer_id, kind, quantity, currency, unit_amount, subtotal, tax_rate, tax_amount, total, provider, bill_to, product_id, level, credit_amount, discount_amount, discount_reason, certificate_id, shipping)
     VALUES ($1, $2, 'product', 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
    [
      buyer.tenantId,
      buyer.userId,
      q.currency,
      q.price,
      q.subtotal,
      q.taxRate,
      q.taxAmount,
      q.total,
      q.provider,
      JSON.stringify(buyer.billTo),
      q.productId,
      q.level,
      q.credit,
      q.discount,
      q.discountReason,
      q.certificateId,
      shipping ? JSON.stringify(shipping) : null,
    ],
  );
  return r.rows[0].id;
}

// Every active product on sale with its price in one currency (USD where it
// has none). The final assessment comes with Full access and isn't sold alone.
export async function priceList(currency: Currency) {
  const r = await pool.query(
    `SELECT p.id, p.kind, p.test_type_id, tt.name AS test_type_name, p.name, p.description, p.duration_days, p.attempts, p.credits, p.sort_order,
       coalesce(pp.amount, usd.amount) AS amount, CASE WHEN pp.amount IS NULL THEN 'USD' ELSE $1 END AS currency
     FROM products p LEFT JOIN test_types tt ON tt.id = p.test_type_id
     LEFT JOIN product_prices pp ON pp.product_id = p.id AND pp.currency = $1
     LEFT JOIN product_prices usd ON usd.product_id = p.id AND usd.currency = 'USD'
     WHERE p.active AND p.kind <> 'final' ORDER BY p.sort_order`,
    [currency],
  );
  return r.rows.map((x) => ({
    id: x.id as string,
    kind: x.kind as string,
    testTypeId: x.test_type_id as string | null,
    testTypeName: x.test_type_name as string | null,
    name: x.name as string,
    description: x.description as string,
    durationDays: x.duration_days as number,
    attempts: x.attempts as number,
    credits: x.credits as number | null,
    amount: Number(x.amount ?? 0),
    currency: x.currency as Currency,
  }));
}
