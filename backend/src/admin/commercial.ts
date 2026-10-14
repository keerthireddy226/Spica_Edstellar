import { z } from "zod";
import { Router, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { startViewAs } from "../auth/viewAs.js";
import { recordAudit } from "../audit/service.js";
import { PaymentError } from "../payments/service.js";
import { CreditNoteError, cancelInvoiceOrder, issueCreditNote, listCreditNotes, markInvoiceOrderPaid } from "../payments/invoiceOrders.js";
import { orgHealth } from "./health.js";
import { requirePermission } from "./staff.js";

// Edstellar-side account management for organizations: contracts, account
// managers, invoice payments and credit notes, health, and "view as".
export const commercialRouter = Router();

function staff(req: AuthedRequest, res: Response): boolean {
  if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

// Organizations this person may act on: an Admin's own, or any for Super Admin.
async function staffOrg(req: AuthedRequest, res: Response, write = false): Promise<string | null> {
  if (!(write ? await requirePermission(req, res, "manageOrganizations") : staff(req, res))) return null;
  const id = String(req.params.id);
  const r = await pool.query(
    `SELECT 1 FROM tenants WHERE id = $1 AND type = 'cohort' AND ($2::boolean OR managed_by = $3 OR account_manager_id = $3)`,
    [id, req.user!.role === "super_admin", req.user!.id],
  );
  if (r.rowCount === 0) {
    res.status(404).json({ error: "organization_not_found" });
    return null;
  }
  return id;
}

// ---- Contract and account manager ----

commercialRouter.get("/organizations/:id/commercial", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffOrg(req, res);
    if (!tenantId) return;
    const t = (
      await pool.query(
        `SELECT t.contract_start, t.contract_end, t.contract_value_cents, t.contract_currency, t.contract_notes, t.account_manager_id,
           coalesce(nullif(concat_ws(' ', am.first_name, am.last_name), ''), am.email) AS account_manager_name
         FROM tenants t LEFT JOIN users am ON am.id = t.account_manager_id WHERE t.id = $1`,
        [tenantId],
      )
    ).rows[0];
    const orders = await pool.query(
      `SELECT o.id, o.quote_number, o.po_number, o.quantity, o.currency, o.total, o.status, o.due_date, o.created_at, o.provider,
         i.id AS invoice_id, i.invoice_number,
         (SELECT coalesce(sum(c.amount), 0)::int FROM credit_notes c WHERE c.invoice_id = i.id) AS credited
       FROM payment_orders o LEFT JOIN invoices i ON i.order_id = o.id
       WHERE o.tenant_id = $1 AND (o.provider = 'invoice' OR o.status = 'paid')
       ORDER BY o.created_at DESC LIMIT 50`,
      [tenantId],
    );
    const managers = await pool.query(
      `SELECT id, coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) AS name FROM users
       WHERE role IN ('admin', 'super_admin') AND deleted_at IS NULL ORDER BY name`,
    );
    const health = (await orgHealth([tenantId])).get(tenantId);
    res.json({
      contract: {
        start: t.contract_start,
        end: t.contract_end,
        valueCents: t.contract_value_cents,
        currency: t.contract_currency,
        notes: t.contract_notes,
      },
      accountManager: t.account_manager_id ? { id: t.account_manager_id, name: t.account_manager_name } : null,
      accountManagerOptions: managers.rows,
      orders: orders.rows.map((o) => ({
        id: o.id,
        provider: o.provider,
        quoteNumber: o.quote_number,
        poNumber: o.po_number,
        quantity: o.quantity,
        currency: o.currency,
        total: o.total,
        status: o.status,
        dueDate: o.due_date,
        createdAt: o.created_at,
        invoiceId: o.invoice_id,
        invoiceNumber: o.invoice_number,
        credited: o.credited,
      })),
      health,
    });
  } catch (err) {
    next(err);
  }
});

commercialRouter.patch("/organizations/:id/commercial", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffOrg(req, res, true);
    if (!tenantId) return;
    const body = z
      .object({
        contractStart: z.string().date().nullable().optional(),
        contractEnd: z.string().date().nullable().optional(),
        contractValueCents: z.number().int().min(0).nullable().optional(),
        contractCurrency: z.enum(["USD", "INR", "EUR", "GBP"]).nullable().optional(),
        contractNotes: z.string().trim().max(2000).nullable().optional(),
        accountManagerId: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    if (body.contractStart && body.contractEnd && body.contractEnd < body.contractStart) {
      return res.status(400).json({ error: "contract_end_before_start" });
    }
    if (body.accountManagerId) {
      const ok = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role IN ('admin', 'super_admin') AND deleted_at IS NULL`, [body.accountManagerId]);
      if (ok.rowCount === 0) return res.status(400).json({ error: "invalid_account_manager" });
    }
    const cols: Record<string, string> = {
      contractStart: "contract_start",
      contractEnd: "contract_end",
      contractValueCents: "contract_value_cents",
      contractCurrency: "contract_currency",
      contractNotes: "contract_notes",
      accountManagerId: "account_manager_id",
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [k, col] of Object.entries(cols)) {
      const v = body[k as keyof typeof body];
      if (v === undefined) continue;
      values.push(v);
      sets.push(`${col} = $${values.length}`);
    }
    if (sets.length) {
      values.push(tenantId);
      await pool.query(`UPDATE tenants SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      await recordAudit({
        tenantId,
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: "organization.contract_updated",
        targetType: "organization",
        details: body,
        ip: req.ip ?? null,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Invoice payments and credit notes ----

commercialRouter.post("/organizations/:id/orders/:orderId/mark-paid", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffOrg(req, res, true);
    if (!tenantId) return;
    const body = z.object({ reference: z.string().trim().min(1).max(100) }).parse(req.body);
    const r = await markInvoiceOrderPaid({ orderId: String(req.params.orderId), tenantId, reference: body.reference, actorId: req.user!.id });
    await recordAudit({
      tenantId,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "billing.invoice_paid",
      targetType: "organization",
      details: { orderId: req.params.orderId, reference: body.reference, alreadyPaid: r.alreadyPaid },
      ip: req.ip ?? null,
    });
    res.json(r);
  } catch (err) {
    if (err instanceof PaymentError) return res.status(404).json({ error: err.code });
    next(err);
  }
});

commercialRouter.post("/organizations/:id/orders/:orderId/cancel", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffOrg(req, res, true);
    if (!tenantId) return;
    const ok = await cancelInvoiceOrder(String(req.params.orderId), tenantId);
    if (!ok) return res.status(404).json({ error: "order_not_found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

commercialRouter.post("/organizations/:id/invoices/:invoiceId/credit-notes", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffOrg(req, res, true);
    if (!tenantId) return;
    const body = z
      .object({
        amount: z.number().int().positive(),
        licensesToRemove: z.number().int().min(0).default(0),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(req.body);
    const own = await pool.query(`SELECT 1 FROM invoices WHERE id = $1 AND tenant_id = $2`, [String(req.params.invoiceId), tenantId]);
    if (own.rowCount === 0) return res.status(404).json({ error: "invoice_not_found" });
    const cn = await issueCreditNote({ invoiceId: String(req.params.invoiceId), ...body, actorId: req.user!.id });
    await recordAudit({
      tenantId,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "billing.credit_note",
      targetType: "organization",
      targetLabel: cn.creditNoteNumber,
      details: body,
      ip: req.ip ?? null,
    });
    res.status(201).json(cn);
  } catch (err) {
    if (err instanceof CreditNoteError) return res.status(err.code === "invoice_not_found" ? 404 : 400).json({ error: err.code });
    next(err);
  }
});

commercialRouter.get("/organizations/:id/invoices/:invoiceId/credit-notes", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffOrg(req, res);
    if (!tenantId) return;
    res.json({ creditNotes: await listCreditNotes(String(req.params.invoiceId)) });
  } catch (err) {
    next(err);
  }
});

// ---- Health across organizations ----

commercialRouter.get("/health", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!staff(req, res)) return;
    const orgs = await pool.query(
      `SELECT id, name FROM tenants WHERE type = 'cohort' AND deactivated_at IS NULL AND ($1::boolean OR managed_by = $2 OR account_manager_id = $2)`,
      [req.user!.role === "super_admin", req.user!.id],
    );
    const health = await orgHealth(orgs.rows.map((o) => o.id));
    res.json({
      organizations: orgs.rows
        .map((o) => ({ id: o.id, name: o.name, ...health.get(o.id)! }))
        .sort((a, b) => a.score - b.score),
    });
  } catch (err) {
    next(err);
  }
});

// ---- Read-only "view as" the Org Admin ----

// Opens the organization's console exactly as its Org Admin sees it, but
// read-only, for an hour, and recorded in the organization's audit log. The
// staff member's own session is kept and restored on exit.
commercialRouter.post("/organizations/:id/view-as", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffOrg(req, res, true);
    if (!tenantId) return;
    const oa = (await pool.query(`SELECT id, email FROM users WHERE tenant_id = $1 AND role = 'org_admin' AND deleted_at IS NULL`, [tenantId])).rows[0];
    if (!oa) return res.status(404).json({ error: "org_admin_not_found" });
    await recordAudit({
      tenantId,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "org_admin.viewed_as",
      targetType: "org_admin",
      targetId: oa.id,
      targetLabel: oa.email,
      ip: req.ip ?? null,
    });
    await startViewAs(req, res, oa.id, req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
