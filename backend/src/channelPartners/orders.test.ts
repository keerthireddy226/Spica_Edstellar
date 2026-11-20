import { describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { quoteOrder } from "./orders.js";

// Prices for a partner order come from the normal price list (no database
// writes; reads products and organisation categories only).
describe("quoteOrder", () => {
  it("prices Full access per learner-month and adds 18% GST in India, in USD like everyone", async () => {
    const q = await quoteOrder({ organisationIds: [], lines: [{ kind: "full_access", quantity: 100 }], inIndia: true, validUntil: "2099-01-01", licenceMonths: 3 }, { allowOverride: false });
    expect(q.currency).toBe("USD");
    expect(q.lines[0].amount).toBe(q.lines[0].unitAmount * 100 * 3);
    expect(q.taxRate).toBe(18);
    expect(q.total).toBe(q.subtotal + Math.round(q.subtotal * 0.18));
  });
  it("charges USD with no Indian GST abroad, and only staff can set a special price", async () => {
    const input = { organisationIds: [], lines: [{ kind: "credits" as const, quantity: 10, unitAmount: 1 }], inIndia: false, validUntil: "2099-01-01", licenceMonths: 1 as const };
    const partner = await quoteOrder(input, { allowOverride: false });
    const staff = await quoteOrder(input, { allowOverride: true });
    expect(partner.currency).toBe("USD");
    expect(partner.taxAmount).toBe(0);
    expect(partner.lines[0].priceOverridden).toBe(false);
    expect(staff.lines[0].amount).toBe(10);
  });
  it("counts preparation credits per month", async () => {
    const p = (await pool.query(`SELECT id, credits FROM products WHERE id = 'prep_fourSkills'`)).rows[0];
    if (!p) return;
    const q = await quoteOrder({ organisationIds: [], lines: [{ kind: "product", productId: p.id, quantity: 2 }], inIndia: true, validUntil: "2099-01-01", licenceMonths: 3 }, { allowOverride: false });
    expect(q.lines[0].credits).toBe(p.credits * 3 * 2);
  });
});
