import bcrypt from "bcrypt";
import { pool } from "./db.js";
import { poolSummary } from "./licenses/service.js";
import { runContractRenewalAlerts } from "./admin/renewals.js";

const q = (t: string, p: unknown[] = []) => pool.query(t, p);
const check = (n: string, c: boolean, x: unknown = "") => console.log(c ? "PASS" : "FAIL", n, c ? "" : JSON.stringify(x));
const API = "http://localhost:4000/api";
const hash = await bcrypt.hash("123456", 4);
const admin = (await q(`INSERT INTO users (role, email, password_hash, email_verified) VALUES ('admin', 'zz-e-admin@example.com', $1, true) RETURNING id`, [hash])).rows[0].id;
const t = (await q(`INSERT INTO tenants (name, type, category, plan_tier, country, managed_by) VALUES ('ZZ phaseE', 'cohort', 'company', 'business', 'US', $1) RETURNING id`, [admin])).rows[0].id;
const mk = async (role: string, email: string) =>
  (await q(`INSERT INTO users (role, tenant_id, email, password_hash, email_verified) VALUES ($1,$2,$3,$4,true) RETURNING id`, [role, t, email, hash])).rows[0].id;
function client() {
  let cookie = "";
  return async (path: string, method = "GET", body?: unknown) => {
    const r = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      const jar = new Map(cookie.split("; ").filter(Boolean).map((x) => x.split("=") as [string, string]));
      if (v === "" || c.includes("Expires=Thu, 01 Jan 1970")) jar.delete(k);
      else jar.set(k, v);
      cookie = [...jar].map(([a, b]) => `${a}=${b}`).join("; ");
    }
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
try {
  const oa = await mk("org_admin", "zz-e-oa@example.com");
  const org = client();
  await org("/auth/login", "POST", { email: "zz-e-oa@example.com", password: "123456", allowedRoles: ["org_admin"] });

  check("bad EIN rejected", (await org("/org-admin/organization", "PATCH", { taxId: "12-34" })).body?.error === "invalid_tax_id");
  check("good EIN saved, normalised", (await org("/org-admin/organization", "PATCH", { taxId: "12-3456789" })).status === 200);

  const io = await org("/payments/invoice-orders", "POST", { quantity: 60, poNumber: "PO-778" });
  check("invoice order with quote number", io.status === 201 && /^Q-\d{4}-\d{5}$/.test(io.body.quoteNumber), io.body);
  const quote = await org(`/payments/quotes/${io.body.orderId}`);
  check("quote shows business price, due date, PO", quote.body.unitAmount === 9000 && quote.body.poNumber === "PO-778" && !!quote.body.dueDate, quote.body);
  check("org sees pending order", (await org("/payments/invoice-orders")).body.orders[0]?.status === "created");

  const st = client();
  await st("/auth/login", "POST", { email: "zz-e-admin@example.com", password: "123456", allowedRoles: ["admin", "super_admin"] });
  const before = (await poolSummary(t)).available;
  const paid = await st(`/admin/organizations/${t}/orders/${io.body.orderId}/mark-paid`, "POST", { reference: "BANK-123" });
  check("mark paid issues invoice and licenses", paid.status === 200 && (await poolSummary(t)).available === before + 60, paid.body);
  const again = await st(`/admin/organizations/${t}/orders/${io.body.orderId}/mark-paid`, "POST", { reference: "BANK-123" });
  check("marking paid twice is a no-op", again.body?.alreadyPaid === true && (await poolSummary(t)).available === before + 60);

  const com = await st(`/admin/organizations/${t}/commercial`);
  const order = com.body.orders.find((o: any) => o.id === io.body.orderId);
  check("commercial view lists paid order with invoice", !!order?.invoiceNumber, com.body);
  check("too-large credit note rejected", (await st(`/admin/organizations/${t}/invoices/${order.invoiceId}/credit-notes`, "POST", { amount: 99999999, reason: "test" })).body?.error === "amount_too_high");
  check("removing more licenses than unused rejected", (await st(`/admin/organizations/${t}/invoices/${order.invoiceId}/credit-notes`, "POST", { amount: 100, licensesToRemove: 61, reason: "test" })).body?.error === "not_enough_unused_licenses");
  const cn = await st(`/admin/organizations/${t}/invoices/${order.invoiceId}/credit-notes`, "POST", { amount: 90000, licensesToRemove: 10, reason: "Over-ordered" });
  check("credit note issued, 10 licenses removed", /^CN-\d{4}-\d{5}$/.test(cn.body?.creditNoteNumber) && (await poolSummary(t)).available === before + 50, cn.body);
  const inv = await org(`/payments/invoices/${order.invoiceId}`);
  check("invoice shows the credit note", inv.body.creditNotes?.length === 1 && inv.body.creditNotes[0].amount === 90000, inv.body);

  await q(`UPDATE tenants SET plan_tier='starter' WHERE id=$1`, [t]);
  check("starter can't pay by invoice", (await org("/payments/invoice-orders", "POST", { quantity: 5 })).body?.error === "plan_feature_locked");
  await q(`UPDATE tenants SET plan_tier='business' WHERE id=$1`, [t]);

  const end = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  check("contract saved", (await st(`/admin/organizations/${t}/commercial`, "PATCH", { contractStart: "2026-01-01", contractEnd: end, contractValueCents: 1200000, contractCurrency: "USD", accountManagerId: admin })).status === 200);
  check("contract end before start rejected", (await st(`/admin/organizations/${t}/commercial`, "PATCH", { contractStart: "2026-12-01", contractEnd: "2026-01-01" })).body?.error === "contract_end_before_start");
  await runContractRenewalAlerts();
  await runContractRenewalAlerts();
  const ren = (await q(`SELECT user_id FROM notifications WHERE kind='contract_renewal' AND user_id = ANY($1::uuid[])`, [[admin, oa]])).rows;
  check("renewal alert to account manager and Org Admin, once", ren.length === 2, ren);
  const plan = await org("/plans/me");
  check("Org Admin sees contract and account manager", plan.body.contract?.end === end && plan.body.accountManager?.email === "zz-e-admin@example.com", plan.body);
  const health = await st("/admin/health");
  const h = health.body.organizations.find((o: any) => o.id === t);
  check("health score and flags", typeof h?.score === "number" && h.flags.some((f: string) => f.includes("Contract renews")), h);

  // View as
  const va = await st(`/admin/organizations/${t}/view-as`, "POST");
  check("view-as started", va.status === 200);
  const me = await st("/auth/me");
  check("now seeing the Org Admin's account, flagged", me.body.role === "org_admin" && me.body.viewAs?.impersonatorName, me.body);
  check("read access works", (await st("/org-admin/overview")).status === 200);
  check("writes blocked", (await st("/org-admin/batches", "POST", { name: "nope" })).body?.error === "read_only_session");
  await org("/auth/logout", "POST");
  check("real Org Admin can still sign in during view-as", (await client()("/auth/login", "POST", { email: "zz-e-oa@example.com", password: "123456", allowedRoles: ["org_admin"] })).status === 200);
  const ex = await st("/auth/view-as/exit", "POST");
  check("exit restores the staff session", ex.body?.restored === true && (await st("/auth/me")).body.role === "admin", ex.body);
  await new Promise((r) => setTimeout(r, 200));
  const aud = await q(`SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action='org_admin.viewed_as'`, [t]);
  check("view-as recorded in the org's audit log", aud.rows[0].n === 1);
  await st("/auth/logout", "POST");
} finally {
  await q(`DELETE FROM credit_notes WHERE tenant_id=$1`, [t]);
  await q(`DELETE FROM invoices WHERE tenant_id=$1`, [t]);
  await q(`DELETE FROM payment_orders WHERE tenant_id=$1`, [t]);
  for (const tbl of ["audit_log", "tenant_plan_events", "license_events", "license_assignments", "license_purchases"]) await q(`DELETE FROM ${tbl} WHERE tenant_id=$1`, [t]);
  await q(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE tenant_id=$1) OR user_id=$2`, [t, admin]);
  await q(`DELETE FROM users WHERE tenant_id=$1`, [t]);
  await q(`DELETE FROM tenants WHERE id=$1`, [t]);
  await q(`DELETE FROM users WHERE id=$1`, [admin]);
  await pool.end();
}
