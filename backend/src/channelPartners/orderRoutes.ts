// Paid orders API (Channel Partners stage 5): the partner portal's own orders
// (/api/partner/orders) and Spica staff for every order (/api/admin/partner-orders).
import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission, staffPermissions, requireStaff, isSuperAdmin } from "../admin/staff.js";
import { createPaymentLink, orderDocument, recordPayment, sendProforma, suggestedBillTo } from "./financeOrders.js";
import { changeStatus, createOrder, getOrder, listOrders, orderProducts, ORDER_STATUSES, quoteOrder, updateOrder, type OrderInput } from "./orders.js";
import { sendPartnerError } from "./portalRoutes.js";

export const orderInputSchema = z.object({
  organisationIds: z.array(z.string().uuid()).min(1).max(500),
  lines: z
    .array(
      z.object({
        kind: z.enum(["full_access", "product", "credits"]),
        productId: z.string().max(60).nullish(),
        level: z.string().max(4).nullish(),
        quantity: z.coerce.number().int().min(1).max(100000),
        unitAmount: z.coerce.number().int().min(0).max(100_000_000).nullish(),
      }),
    )
    .min(1)
    .max(20),
  inIndia: z.boolean(),
  gstin: z.string().trim().max(20).nullish(),
  maxOrganisations: z.coerce.number().int().min(1).max(500).optional(),
  perOrgCap: z.coerce.number().int().min(1).max(100000).nullish(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  licenceMonths: z.union([z.literal(1), z.literal(3), z.literal(6)]),
  notes: z.string().trim().max(2000).nullish(),
});
const statusSchema = z.object({ to: z.enum(ORDER_STATUSES), note: z.string().trim().max(1000).nullish() });

const actorOf = (req: AuthedRequest) => ({ id: req.user!.id, role: req.user!.role, ip: req.ip ?? null });

function fail(err: unknown, res: Response, next: (e: unknown) => void) {
  if (err instanceof z.ZodError) return res.status(400).json({ error: "validation_error", issues: err.issues });
  if (!sendPartnerError(err, res)) next(err);
}

async function myPartnerId(req: AuthedRequest, res: Response): Promise<string | null> {
  if (req.user?.role !== "channel_partner") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  const r = await pool.query(`SELECT id FROM channel_partners WHERE user_id = $1 AND deactivated_at IS NULL`, [req.user.id]);
  if (!r.rowCount) {
    res.status(403).json({ error: "partner_deactivated" });
    return null;
  }
  return r.rows[0].id;
}

// ---- Partner portal ----
export const partnerOrdersRouter = Router();
partnerOrdersRouter.use(requireAuth);

partnerOrdersRouter.get("/products", async (req: AuthedRequest, res, next) => {
  if (!(await myPartnerId(req, res))) return;
  orderProducts().then((products) => res.json({ products }), next);
});
partnerOrdersRouter.post("/quote", async (req: AuthedRequest, res, next) => {
  if (!(await myPartnerId(req, res))) return;
  try {
    res.json(await quoteOrder(orderInputSchema.parse(req.body) as OrderInput, { allowOverride: false }));
  } catch (err) {
    fail(err, res, next);
  }
});
partnerOrdersRouter.get("/", async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  listOrders({ partnerId: id }).then((orders) => res.json({ orders }), next);
});
partnerOrdersRouter.get("/:orderId", async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  getOrder(req.params.orderId as string, id).then((o) => res.json(o), (err) => fail(err, res, next));
});
partnerOrdersRouter.post("/", async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  try {
    const submit = req.body?.submit === true;
    res.status(201).json(await createOrder({ actor: actorOf(req), partnerId: id, input: orderInputSchema.parse(req.body) as OrderInput, submit }));
  } catch (err) {
    fail(err, res, next);
  }
});
partnerOrdersRouter.put("/:orderId", async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  try {
    await updateOrder({ actor: actorOf(req), orderId: req.params.orderId as string, partnerId: id, input: orderInputSchema.parse(req.body) as OrderInput });
    res.json({ ok: true });
  } catch (err) {
    fail(err, res, next);
  }
});
partnerOrdersRouter.post("/:orderId/status", async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  try {
    const b = statusSchema.parse(req.body);
    await changeStatus({ orderId: req.params.orderId as string, to: b.to, note: b.note, actor: actorOf(req), partnerId: id });
    res.json({ ok: true });
  } catch (err) {
    fail(err, res, next);
  }
});

// ---- Spica staff ----
export const staffOrdersRouter = Router();
staffOrdersRouter.use(requireAuth);

// Seeing orders: Admins who manage organisations, and Finance.
async function canSeeOrders(req: AuthedRequest, res: Response): Promise<boolean> {
  if (!requireStaff(req, res)) return false;
  if (isSuperAdmin(req)) return true;
  const p = await staffPermissions(req);
  if (p.manageOrganizations || p.finance) return true;
  res.status(403).json({ error: "permission_required", permission: "finance" });
  return false;
}

staffOrdersRouter.get("/products", async (req: AuthedRequest, res, next) => {
  if (!(await canSeeOrders(req, res))) return;
  orderProducts().then((products) => res.json({ products }), next);
});
// Organisations an order can name: the partner's, or all for a direct order.
staffOrdersRouter.get("/organisations", async (req: AuthedRequest, res, next) => {
  if (!(await canSeeOrders(req, res))) return;
  const partnerId = typeof req.query.partnerId === "string" && req.query.partnerId ? req.query.partnerId : null;
  pool
    .query(`SELECT id, name, category FROM tenants WHERE type = 'cohort' AND deactivated_at IS NULL AND ($1::uuid IS NULL OR channel_partner_id = $1) ORDER BY name LIMIT 1000`, [partnerId])
    .then((r) => res.json({ organisations: r.rows }), next);
});
staffOrdersRouter.post("/quote", async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    res.json(await quoteOrder(orderInputSchema.parse(req.body) as OrderInput, { allowOverride: true }));
  } catch (err) {
    fail(err, res, next);
  }
});
staffOrdersRouter.get("/", async (req: AuthedRequest, res, next) => {
  if (!(await canSeeOrders(req, res))) return;
  const status = typeof req.query.status === "string" && (ORDER_STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : null;
  const partnerId = typeof req.query.partnerId === "string" && /^[0-9a-f-]{36}$/.test(req.query.partnerId) ? req.query.partnerId : null;
  listOrders({ status, partnerId }).then((orders) => res.json({ orders }), next);
});
staffOrdersRouter.get("/:orderId", async (req: AuthedRequest, res, next) => {
  if (!(await canSeeOrders(req, res))) return;
  getOrder(req.params.orderId as string, null).then((o) => res.json(o), (err) => fail(err, res, next));
});
staffOrdersRouter.post("/", async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const partnerId = typeof req.body?.partnerId === "string" && req.body.partnerId ? z.string().uuid().parse(req.body.partnerId) : null;
    res.status(201).json(await createOrder({ actor: actorOf(req), partnerId, input: orderInputSchema.parse(req.body) as OrderInput, submit: req.body?.submit === true }));
  } catch (err) {
    fail(err, res, next);
  }
});
staffOrdersRouter.put("/:orderId", async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    await updateOrder({ actor: actorOf(req), orderId: req.params.orderId as string, partnerId: null, input: orderInputSchema.parse(req.body) as OrderInput });
    res.json({ ok: true });
  } catch (err) {
    fail(err, res, next);
  }
});
staffOrdersRouter.post("/:orderId/status", async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const b = statusSchema.parse(req.body);
    await changeStatus({ orderId: req.params.orderId as string, to: b.to, note: b.note, actor: actorOf(req) });
    res.json({ ok: true });
  } catch (err) {
    fail(err, res, next);
  }
});

// ---- Finance ----
const billToSchema = z.object({
  name: z.string().trim().min(1).max(200),
  attention: z.string().trim().max(200).nullish(),
  address: z.string().trim().max(600).nullish(),
  email: z.string().trim().email().max(200),
  gstin: z.string().trim().max(20).nullish(),
  country: z.string().trim().max(2).nullish(),
});
const paymentSchema = z.object({
  method: z.enum(["bank", "stripe", "other"]),
  reference: z.string().trim().max(200).nullish(),
  amount: z.coerce.number().int().min(1).max(10_000_000_000),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

staffOrdersRouter.get("/:orderId/bill-to", async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "finance"))) return;
  suggestedBillTo(req.params.orderId as string).then((billTo) => res.json({ billTo }), (err) => fail(err, res, next));
});
staffOrdersRouter.post("/:orderId/proforma", async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "finance"))) return;
  try {
    res.json(await sendProforma({ orderId: req.params.orderId as string, actor: actorOf(req), billTo: billToSchema.parse(req.body?.billTo) }));
  } catch (err) {
    fail(err, res, next);
  }
});
staffOrdersRouter.post("/:orderId/payment-link", async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "finance"))) return;
  try {
    res.json(await createPaymentLink({ orderId: req.params.orderId as string, actor: actorOf(req) }));
  } catch (err) {
    fail(err, res, next);
  }
});
staffOrdersRouter.post("/:orderId/payment", async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "finance"))) return;
  try {
    const b = paymentSchema.parse(req.body);
    res.json(await recordPayment({ orderId: req.params.orderId as string, actor: actorOf(req), method: b.method, reference: b.reference ?? null, amount: b.amount, receivedOn: b.receivedOn }));
  } catch (err) {
    fail(err, res, next);
  }
});

// ---- The proforma and the final invoice (staff, the partner, the organisations' admins) ----
export const orderDocumentsRouter = Router();
orderDocumentsRouter.get("/:orderId/:kind", requireAuth, async (req: AuthedRequest, res, next) => {
  const kind = req.params.kind === "invoice" ? "invoice" : req.params.kind === "proforma" ? "proforma" : null;
  if (!kind || !/^[0-9a-f-]{36}$/.test(String(req.params.orderId))) return res.status(404).json({ error: "not_found" });
  try {
    const u = req.user!;
    let staffOk = u.role === "super_admin";
    if (u.role === "admin") {
      const p = await staffPermissions(req);
      staffOk = p.manageOrganizations || p.finance;
    }
    const doc = await orderDocument(String(req.params.orderId), kind, { id: u.id, role: u.role, tenantId: u.tenantId ?? null, staffOk });
    if (!doc) return res.status(404).json({ error: "not_found" });
    res.json(doc);
  } catch (err) {
    next(err);
  }
});
