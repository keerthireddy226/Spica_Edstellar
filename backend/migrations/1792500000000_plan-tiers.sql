-- Up Migration
-- Organizations sit on a plan tier. The tier sets the price per license and
-- which management features are available; learners get the same product on
-- every tier. Tiers change by commitment (a qualifying purchase or a contract
-- set by an Admin), never automatically by usage.

ALTER TABLE tenants
  ADD COLUMN plan_tier text NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter', 'business', 'enterprise')),
  ADD COLUMN plan_changed_at timestamptz,
  -- Negotiated per-license-month price in USD cents; overrides the rate card.
  ADD COLUMN custom_price_cents integer CHECK (custom_price_cents IS NULL OR custom_price_cents >= 0),
  ADD COLUMN pilot_ends_at timestamptz;

-- Organizations that already exist keep everything they use today.
UPDATE tenants SET plan_tier = 'business', plan_changed_at = now() WHERE type = 'cohort';

-- Every tier change, pilot and Enterprise enquiry, for the Admin's history view.
CREATE TABLE tenant_plan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('tier_change', 'price_change', 'pilot_started', 'pilot_ended', 'enterprise_inquiry')),
  from_tier text,
  to_tier text,
  custom_price_cents integer,
  note text,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_plan_events_tenant ON tenant_plan_events(tenant_id, created_at DESC);

INSERT INTO tenant_plan_events (tenant_id, kind, from_tier, to_tier, note)
SELECT id, 'tier_change', 'starter', 'business', 'Existing organization moved to Business when plans were introduced'
FROM tenants WHERE type = 'cohort';

-- Down Migration
DROP TABLE IF EXISTS tenant_plan_events;
ALTER TABLE tenants
  DROP COLUMN IF EXISTS pilot_ends_at,
  DROP COLUMN IF EXISTS custom_price_cents,
  DROP COLUMN IF EXISTS plan_changed_at,
  DROP COLUMN IF EXISTS plan_tier;
