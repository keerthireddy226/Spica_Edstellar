-- Up Migration
-- Partner types (user, 19 Nov 2026): Reseller, Channel Partner, Affiliate and
-- Referral Partner share the channel_partner login and table. The 3-month
-- partnership period reuses demo_starts_at / demo_ends_at (the demo window);
-- demo_ended_at is set when Spica ends it early (termination).
ALTER TABLE channel_partners
  ADD COLUMN partner_type text NOT NULL DEFAULT 'channel_partner'
    CHECK (partner_type IN ('reseller', 'channel_partner', 'affiliate', 'referral')),
  -- Fixed by Spica staff; the partner cannot change them.
  ADD COLUMN min_organisations integer NOT NULL DEFAULT 10 CHECK (min_organisations >= 0),
  ADD COLUMN min_licences_per_org integer NOT NULL DEFAULT 1 CHECK (min_licences_per_org >= 1),
  -- Reseller: buys at list price minus this discount.
  ADD COLUMN discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 90),
  -- Referral Partner: fixed fee per qualifying purchase, in minor units.
  ADD COLUMN referral_fee integer NOT NULL DEFAULT 0 CHECK (referral_fee >= 0),
  ADD COLUMN referral_fee_currency text NOT NULL DEFAULT 'INR' CHECK (referral_fee_currency IN ('INR', 'USD')),
  ADD COLUMN terminated_at timestamptz,
  ADD COLUMN termination_reason text,
  ADD COLUMN terminated_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Each renewal (another 3 months). override_reason is set when the partner had
-- fewer organisations than its minimum and an Admin renewed anyway.
CREATE TABLE partner_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES channel_partners(id) ON DELETE CASCADE,
  previous_end timestamptz,
  new_end timestamptz NOT NULL,
  organisations integer NOT NULL,
  min_organisations integer NOT NULL,
  override_reason text,
  renewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_renewals_partner ON partner_renewals (partner_id, created_at DESC);

-- The partnership agreement, signed in the app for each partnership period.
CREATE TABLE partner_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES channel_partners(id) ON DELETE CASCADE,
  version text NOT NULL,
  partner_type text NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  signed_name text NOT NULL,
  signed_email text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_partner_agreements_partner ON partner_agreements (partner_id, signed_at DESC);

-- Affiliate attribution: the partner whose link or code a person used at
-- sign-up or checkout (no cookies).
ALTER TABLE users
  ADD COLUMN referred_by_partner_id uuid REFERENCES channel_partners(id) ON DELETE SET NULL,
  ADD COLUMN referred_at timestamptz;
CREATE INDEX idx_users_referred_by_partner ON users (referred_by_partner_id) WHERE referred_by_partner_id IS NOT NULL;

-- Referral Partner leads.
CREATE TABLE partner_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES channel_partners(id) ON DELETE CASCADE,
  organisation_name text NOT NULL,
  category text NOT NULL DEFAULT 'company' CHECK (category IN ('university', 'company')),
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text,
  country text NOT NULL,
  expected_learners integer,
  notes text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'contacted', 'won', 'lost', 'duplicate')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  staff_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_leads_partner ON partner_leads (partner_id, created_at DESC);
CREATE UNIQUE INDEX idx_partner_leads_tenant ON partner_leads (tenant_id) WHERE tenant_id IS NOT NULL;

-- What Affiliates and Referral Partners earn.
CREATE TABLE partner_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES channel_partners(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('affiliate_sale', 'referral_fee')),
  source_type text NOT NULL CHECK (source_type IN ('payment_order', 'license_purchase')),
  source_id uuid NOT NULL,
  lead_id uuid REFERENCES partner_leads(id) ON DELETE SET NULL,
  description text NOT NULL,
  base_amount integer NOT NULL DEFAULT 0,
  rate numeric(5,2),
  amount integer NOT NULL CHECK (amount >= 0),
  currency text NOT NULL,
  earned_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'paid', 'void')),
  paid_at timestamptz,
  paid_reference text,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, source_type, source_id)
);
CREATE INDEX idx_partner_earnings_partner ON partner_earnings (partner_id, earned_at DESC);

-- Down Migration
DROP TABLE IF EXISTS partner_earnings;
DROP TABLE IF EXISTS partner_leads;
DROP INDEX IF EXISTS idx_users_referred_by_partner;
ALTER TABLE users DROP COLUMN IF EXISTS referred_at, DROP COLUMN IF EXISTS referred_by_partner_id;
DROP TABLE IF EXISTS partner_agreements;
DROP TABLE IF EXISTS partner_renewals;
ALTER TABLE channel_partners
  DROP COLUMN IF EXISTS terminated_by, DROP COLUMN IF EXISTS termination_reason, DROP COLUMN IF EXISTS terminated_at,
  DROP COLUMN IF EXISTS referral_fee_currency, DROP COLUMN IF EXISTS referral_fee, DROP COLUMN IF EXISTS discount_percent,
  DROP COLUMN IF EXISTS min_licences_per_org, DROP COLUMN IF EXISTS min_organisations, DROP COLUMN IF EXISTS partner_type;
