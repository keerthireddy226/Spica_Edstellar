import { z } from "zod";
import { pool } from "../db.js";
import { termsUrl, termsVersion } from "../auth/schemas.js";
import { PaymentError, type Buyer } from "./service.js";

// What an individual buyer agrees to at checkout (consent register N02–N04).
// Organisations agree to their own Customer Agreement instead.
//  - The Refund and Cancellation Policy: once the Terms (which contain it) are published.
//  - Monthly renewal: when starting a subscription.
//  - EU, EEA and UK buyers: that access starts now and the 14-day right to cancel ends.

// EU member states, the other EEA countries and the United Kingdom.
const WITHDRAWAL_RIGHT_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "GB",
]);

export const agreementsSchema = z
  .object({ refundPolicy: z.boolean().optional(), renewal: z.boolean().optional(), withdrawalWaiver: z.boolean().optional() })
  .optional();
export type Agreements = z.infer<typeof agreementsSchema>;

export const RENEWAL_VERSION = "v1";
export const WAIVER_VERSION = "v1";

export interface CheckoutTerms {
  refundPolicyUrl: string | null;
  withdrawalWaiver: boolean;
}

export function checkoutTerms(buyer: Buyer | null): CheckoutTerms {
  if (!buyer || buyer.kind !== "individual_plan") return { refundPolicyUrl: null, withdrawalWaiver: false };
  return {
    refundPolicyUrl: termsVersion() ? termsUrl() : null,
    withdrawalWaiver: WITHDRAWAL_RIGHT_COUNTRIES.has((buyer.billingCountry ?? "").toUpperCase()),
  };
}

// Throws when an agreement the buyer must give is missing.
export function requireAgreements(buyer: Buyer, a: Agreements, opts: { renewal?: boolean } = {}): void {
  if (buyer.kind !== "individual_plan") return;
  const t = checkoutTerms(buyer);
  if (t.refundPolicyUrl && !a?.refundPolicy) throw new PaymentError("refund_policy_required");
  if (t.withdrawalWaiver && !a?.withdrawalWaiver) throw new PaymentError("withdrawal_waiver_required");
  if (opts.renewal && !a?.renewal) throw new PaymentError("renewal_agreement_required");
}

// Keeps what was agreed, tied to the order or subscription.
export async function recordAgreements(buyer: Buyer, ref: string, ip: string | null, opts: { renewal?: boolean } = {}): Promise<void> {
  if (buyer.kind !== "individual_plan") return;
  const t = checkoutTerms(buyer);
  const rows: [string, string][] = [];
  if (t.refundPolicyUrl) rows.push(["refund_policy", `${termsVersion()}:${ref}`]);
  if (t.withdrawalWaiver) rows.push(["withdrawal_waiver", `${WAIVER_VERSION}:${ref}`]);
  if (opts.renewal) rows.push(["subscription_renewal", `${RENEWAL_VERSION}:${ref}`]);
  for (const [type, version] of rows) {
    await pool.query(`INSERT INTO consent_records (user_id, consent_version, consent_type, ip_address) VALUES ($1, $2, $3, $4)`, [buyer.userId, version, type, ip]);
  }
}
