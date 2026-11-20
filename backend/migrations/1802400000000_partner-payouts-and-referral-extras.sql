-- Up Migration
-- Partner work of 20 Nov 2026 (owner: "complete all of these by default").

-- 1. Payout details: where Spica sends a partner's earnings. Filled in by the
--    partner in their Profile; Spica pays only partners who have filled them in.
--    Bank transfer, or PayPal for partners outside India. No tax deduction or
--    partner invoice yet (to be confirmed by Finance).
CREATE TABLE partner_payout_details (
  partner_id uuid PRIMARY KEY REFERENCES channel_partners(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('bank', 'paypal')),
  account_name text,
  account_number text,
  bank_name text,
  bank_code text,          -- IFSC in India, SWIFT/BIC abroad
  bank_country text,
  paypal_email text,
  pan text,
  gstin text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (method <> 'bank' OR (account_name IS NOT NULL AND account_number IS NOT NULL AND bank_code IS NOT NULL)),
  CHECK (method <> 'paypal' OR paypal_email IS NOT NULL)
);

-- 2. Partnership length chosen per partner (months); renewals use it by default.
ALTER TABLE channel_partners ADD COLUMN partnership_months integer NOT NULL DEFAULT 3 CHECK (partnership_months BETWEEN 1 AND 24);

-- 3. Referral extras: a reason the partner can see, the partner withdrawing a
--    referral, and when it was won (for "average days to win").
ALTER TABLE partner_leads ADD COLUMN partner_reason text;
ALTER TABLE partner_leads ADD COLUMN won_at timestamptz;
ALTER TABLE partner_leads DROP CONSTRAINT partner_leads_status_check;
ALTER TABLE partner_leads ADD CONSTRAINT partner_leads_status_check CHECK (status IN ('submitted', 'contacted', 'won', 'lost', 'duplicate', 'withdrawn'));
UPDATE partner_leads SET won_at = updated_at WHERE status = 'won' AND won_at IS NULL;

-- Down Migration
UPDATE partner_leads SET status = 'lost' WHERE status = 'withdrawn';
ALTER TABLE partner_leads DROP CONSTRAINT partner_leads_status_check;
ALTER TABLE partner_leads ADD CONSTRAINT partner_leads_status_check CHECK (status IN ('submitted', 'contacted', 'won', 'lost', 'duplicate'));
ALTER TABLE partner_leads DROP COLUMN IF EXISTS won_at;
ALTER TABLE partner_leads DROP COLUMN IF EXISTS partner_reason;
ALTER TABLE channel_partners DROP COLUMN IF EXISTS partnership_months;
DROP TABLE IF EXISTS partner_payout_details;
