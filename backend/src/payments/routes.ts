import { z } from "zod";
import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import {
  PAYMENT_CONFIG,
  razorpayCreateOrder,
  razorpayVerifyPayment,
  stripeCreateCheckout,
  stripeSessionPaid,
  stripeVerifyWebhook,
  testModeEnabled,
} from "./providers.js";
import {
  INDIVIDUAL_PLAN_MONTHS,
  PaymentError,
  createOrder,
  fulfillOrder,
  getInvoice,
  getOrderForUser,
  listInvoices,
  quote,
  resolveBuyer,
  type Buyer,
} from "./service.js";
import { AttemptError } from "../assessment/service.js";
import { cancelInvoiceOrder, getQuote, listInvoiceOrders, requestInvoiceOrder } from "./invoiceOrders.js";
import { CURRENCIES, createProductOrder, createSwitchOrder, currencyFor, planQuote, priceList, productQuote, type Currency } from "./products.js";

export const paymentsRouter = Router();

function handle(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof PaymentError) {
    const status = err.code === "order_not_found" ? 404 : err.code === "no_provider" ? 503 : 400;
    return res.status(status).json({ error: err.code });
  }
  next(err);
}

paymentsRouter.get("/quote", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const buyer = await resolveBuyer(req.user!);
    if (!buyer) return res.status(403).json({ error: "forbidden" });
    const quantity = z.coerce.number().int().parse(req.query.quantity);
    const currency = typeof req.query.currency === "string" ? req.query.currency : undefined;
    // Full access months for an individual: its price list row, and unused preparation counts towards them.
    const { creditSources: _sources, ...q } = buyer.kind === "individual_plan" ? await planQuote(buyer, quantity, { currency }) : quote(buyer, quantity);
    res.json({
      ...q,
      kind: buyer.kind,
      planMonths: buyer.kind === "individual_plan" ? INDIVIDUAL_PLAN_MONTHS : null,
      testMode: testModeEnabled(),
    });
  } catch (err) {
    handle(err, res, next);
  }
});

// ---- Products (Full access, preparation + assessment, assessment, level test) ----

// The price list in the buyer's currency (or the one they chose).
paymentsRouter.get("/products", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const buyer = await resolveBuyer(req.user!);
    const asked = typeof req.query.currency === "string" ? req.query.currency : null;
    const currency = (CURRENCIES as readonly string[]).includes(asked ?? "") ? (asked as Currency) : currencyFor(buyer?.billingCountry);
    res.json({ currency, currencies: CURRENCIES, canBuy: buyer?.kind === "individual_plan", testMode: testModeEnabled(), products: await priceList(currency) });
  } catch (err) {
    next(err);
  }
});

const productOrderSchema = z.object({
  productId: z.string().min(1).max(60),
  currency: z.string().length(3).optional(),
  level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).optional(),
  // A certificate extra: which certificate, and for a printed copy where to post it.
  certificateId: z.string().uuid().optional(),
  shipping: z
    .object({
      name: z.string().trim().min(1).max(120),
      line1: z.string().trim().min(1).max(200),
      line2: z.string().trim().max(200).optional(),
      city: z.string().trim().min(1).max(100),
      postalCode: z.string().trim().min(1).max(20),
      country: z.string().trim().min(2).max(60),
      phone: z.string().trim().max(30).optional(),
    })
    .optional(),
});

paymentsRouter.get("/product-quote", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const buyer = await resolveBuyer(req.user!);
    if (!buyer || buyer.kind !== "individual_plan") return res.status(403).json({ error: "forbidden" });
    const q = productOrderSchema.parse(req.query);
    res.json(await productQuote(buyer, q.productId, q));
  } catch (err) {
    handle(err, res, next);
  }
});

// An individual buys a product; the browser then pays as for any order.
paymentsRouter.post("/product-orders", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const buyer = await resolveBuyer(req.user!);
    if (!buyer || buyer.kind !== "individual_plan") return res.status(403).json({ error: "forbidden" });
    const body = productOrderSchema.parse(req.body);
    // Full access is bought by the month on the Plans page (POST /orders), at its price list row.
    const kind = (await pool.query(`SELECT kind FROM products WHERE id = $1`, [body.productId])).rows[0]?.kind;
    if (kind === "full") return res.status(400).json({ error: "use_plan_checkout" });
    const q = await productQuote(buyer, body.productId, body);
    if (body.productId === "cert_print" && !body.shipping) return res.status(400).json({ error: "shipping_required" });
    const orderId = await createProductOrder(buyer, q, body.productId === "cert_print" ? body.shipping : null);
    await productCheckout(res, buyer, { orderId, provider: q.provider, currency: q.currency, subtotal: q.subtotal, taxLabel: q.taxLabel, taxAmount: q.taxAmount, total: q.total, name: `${q.productName}${q.level ? ` (${q.level})` : ""}` });
  } catch (err) {
    handle(err, res, next);
  }
});

// Whatever the browser needs to pay a product order: a Stripe Checkout URL,
// Razorpay checkout options, or (dev only) test mode.
async function productCheckout(
  res: Response,
  buyer: Buyer,
  o: { orderId: string; provider: string; currency: Currency; subtotal: number; taxLabel: string | null; taxAmount: number; total: number; name: string },
) {
  const { orderId, name } = o;
  const returnPath = "/checkout/return";
  if (o.provider === "stripe") {
    const session = await stripeCreateCheckout({
      orderId,
      currency: o.currency,
      productName: name,
      unitAmount: o.subtotal,
      quantity: 1,
      taxLabel: o.taxLabel,
      taxAmount: o.taxAmount,
      customerEmail: buyer.email,
      returnPath,
    });
    await pool.query(`UPDATE payment_orders SET provider_order_id = $2 WHERE id = $1`, [orderId, session.sessionId]);
    return res.status(201).json({ orderId, provider: "stripe", redirectUrl: session.url });
  }
  if (o.provider === "razorpay") {
    const rzpOrderId = await razorpayCreateOrder({ orderId, amount: o.total, currency: o.currency });
    await pool.query(`UPDATE payment_orders SET provider_order_id = $2 WHERE id = $1`, [orderId, rzpOrderId]);
    return res.status(201).json({
      orderId,
      provider: "razorpay",
      razorpay: {
        key: PAYMENT_CONFIG.razorpayKeyId,
        orderId: rzpOrderId,
        amount: o.total,
        currency: o.currency,
        name: PAYMENT_CONFIG.seller.name,
        description: name,
        prefill: { email: buyer.email ?? undefined, name: buyer.billTo.name ?? undefined },
      },
    });
  }
  return res.status(201).json({ orderId, provider: "test" });
}

// An individual pays the difference to switch their preparation to a dearer
// test; once paid, the switch is made. A free switch goes through POST /assessment/:id/switch.
paymentsRouter.post("/switch-orders", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const buyer = await resolveBuyer(req.user!);
    if (!buyer || buyer.kind !== "individual_plan") return res.status(403).json({ error: "forbidden" });
    const body = z.object({ entitlementId: z.string().uuid(), testTypeId: z.string().min(1).max(60) }).parse(req.body);
    const o = await createSwitchOrder(buyer, body.entitlementId, body.testTypeId);
    if (!o) return res.status(400).json({ error: "switch_is_free" });
    await productCheckout(res, buyer, o);
  } catch (err) {
    if (err instanceof AttemptError) return res.status(400).json({ error: err.code });
    handle(err, res, next);
  }
});

// Creates the order and returns whatever the browser needs to pay it:
// a Stripe Checkout URL, Razorpay checkout options, or (dev only) test mode.
paymentsRouter.post("/orders", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const buyer = await resolveBuyer(req.user!);
    if (!buyer) return res.status(403).json({ error: "forbidden" });
    const body = z.object({ quantity: z.coerce.number().int(), currency: z.string().length(3).optional() }).parse(req.body);
    const q = buyer.kind === "individual_plan" ? await planQuote(buyer, body.quantity, { currency: body.currency }) : quote(buyer, body.quantity);
    const orderId = await createOrder(buyer, q);
    const returnPath = "/checkout/return";
    const productName = buyer.kind === "individual_plan" ? "Spica learner access (1 month)" : "Spica learner license (1 learner-month)";

    if (q.provider === "stripe") {
      const session = await stripeCreateCheckout({
        orderId,
        currency: q.currency,
        productName,
        // With a credit, one line for the whole (smaller) amount.
        unitAmount: q.credit ? q.subtotal : q.unitAmount,
        quantity: q.credit ? 1 : q.quantity,
        taxLabel: q.taxLabel,
        taxAmount: q.taxAmount,
        customerEmail: buyer.email,
        returnPath,
      });
      await pool.query(`UPDATE payment_orders SET provider_order_id = $2 WHERE id = $1`, [orderId, session.sessionId]);
      return res.status(201).json({ orderId, provider: "stripe", redirectUrl: session.url });
    }
    if (q.provider === "razorpay") {
      const rzpOrderId = await razorpayCreateOrder({ orderId, amount: q.total, currency: q.currency });
      await pool.query(`UPDATE payment_orders SET provider_order_id = $2 WHERE id = $1`, [orderId, rzpOrderId]);
      return res.status(201).json({
        orderId,
        provider: "razorpay",
        razorpay: {
          key: PAYMENT_CONFIG.razorpayKeyId,
          orderId: rzpOrderId,
          amount: q.total,
          currency: q.currency,
          name: PAYMENT_CONFIG.seller.name,
          description: productName,
          prefill: { email: buyer.email ?? undefined, name: buyer.billTo.attention ?? buyer.billTo.name ?? undefined },
        },
      });
    }
    return res.status(201).json({ orderId, provider: "test" });
  } catch (err) {
    handle(err, res, next);
  }
});

// What a product order bought, for the page after checkout.
async function productOf(order: Record<string, any>): Promise<{ name: string; kind: string; level: string | null } | null> {
  if (order.kind !== "product") return null;
  const p = (await pool.query(`SELECT name, kind FROM products WHERE id = $1`, [order.product_id])).rows[0];
  return p ? { name: p.name, kind: p.kind, level: order.level ?? null } : null;
}

paymentsRouter.post("/orders/:id/confirm", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const order = await getOrderForUser(String(req.params.id), req.user!);
    if (!order) return res.status(404).json({ error: "order_not_found" });
    if (order.status === "paid") {
      const r = await fulfillOrder(order.id, order.provider_payment_id);
      return res.json({ status: "paid", invoiceId: r.invoiceId, kind: order.kind, quantity: order.quantity, product: await productOf(order) });
    }

    let paymentId: string | null = null;
    if (order.provider === "stripe") {
      const s = await stripeSessionPaid(order.provider_order_id);
      if (!s.paid || s.orderId !== order.id) return res.status(402).json({ error: "payment_not_verified" });
      paymentId = s.paymentId;
    } else if (order.provider === "razorpay") {
      const body = z
        .object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() })
        .parse(req.body);
      if (body.razorpay_order_id !== order.provider_order_id) return res.status(402).json({ error: "payment_not_verified" });
      if (!razorpayVerifyPayment(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) {
        return res.status(402).json({ error: "payment_not_verified" });
      }
      paymentId = body.razorpay_payment_id;
    } else {
      if (!testModeEnabled()) return res.status(402).json({ error: "payment_not_verified" });
      paymentId = `test_${order.id.slice(0, 8)}`;
    }

    const r = await fulfillOrder(order.id, paymentId);
    res.json({ status: "paid", invoiceId: r.invoiceId, kind: order.kind, quantity: order.quantity, product: await productOf(order) });
  } catch (err) {
    handle(err, res, next);
  }
});

paymentsRouter.post("/orders/:id/cancel", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    await pool.query(`UPDATE payment_orders SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2 AND status = 'created'`, [
      String(req.params.id),
      req.user!.tenantId,
    ]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

paymentsRouter.get("/invoices", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!req.user!.tenantId || !["org_admin", "learner"].includes(req.user!.role)) return res.status(403).json({ error: "forbidden" });
    res.json({ invoices: await listInvoices(req.user!.tenantId) });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.get("/invoices/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const staff = ["admin", "super_admin"].includes(req.user!.role);
    if (!staff && !["org_admin", "learner"].includes(req.user!.role)) return res.status(403).json({ error: "forbidden" });
    const invoice = await getInvoice(String(req.params.id), req.user!.tenantId, staff);
    if (!invoice) return res.status(404).json({ error: "invoice_not_found" });
    res.json(invoice);
  } catch (err) {
    next(err);
  }
});

// Mounted with express.raw() in index.ts — the signature covers the exact
// bytes Stripe sent, so this must run before the JSON body parser.
export async function stripeWebhookHandler(req: Request, res: Response) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!stripeVerifyWebhook(raw, req.header("stripe-signature"))) return res.status(400).json({ error: "invalid_signature" });
  try {
    const event = JSON.parse(raw) as { type: string; data: { object: Record<string, any> } };
    if (event.type === "checkout.session.completed" && event.data.object.payment_status === "paid") {
      const orderId = event.data.object.metadata?.order_id as string | undefined;
      if (orderId) await fulfillOrder(orderId, (event.data.object.payment_intent as string) ?? null);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("stripe webhook failed:", err);
    res.status(500).json({ error: "webhook_failed" });
  }
}

// ---- Pay by invoice (Business and up) ----

paymentsRouter.post("/invoice-orders", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const buyer = await resolveBuyer(req.user!);
    if (!buyer || buyer.kind !== "org_licenses") return res.status(403).json({ error: "forbidden" });
    const body = z.object({ quantity: z.coerce.number().int(), poNumber: z.string().trim().max(100).optional() }).parse(req.body);
    res.status(201).json(await requestInvoiceOrder(buyer, body.quantity, body.poNumber || null));
  } catch (err) {
    handle(err, res, next);
  }
});

paymentsRouter.get("/invoice-orders", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role !== "org_admin" || !req.user!.tenantId) return res.status(403).json({ error: "forbidden" });
    res.json({ orders: await listInvoiceOrders(req.user!.tenantId) });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post("/invoice-orders/:id/cancel", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role !== "org_admin" || !req.user!.tenantId) return res.status(403).json({ error: "forbidden" });
    const ok = await cancelInvoiceOrder(String(req.params.id), req.user!.tenantId);
    if (!ok) return res.status(404).json({ error: "order_not_found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.get("/quotes/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const staff = ["admin", "super_admin"].includes(req.user!.role);
    const q = await getQuote(String(req.params.id), req.user!.tenantId, staff);
    if (!q) return res.status(404).json({ error: "quote_not_found" });
    res.json(q);
  } catch (err) {
    next(err);
  }
});
