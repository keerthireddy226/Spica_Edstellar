-- Up Migration
-- An organization can move to a lower plan at the end of its current period
-- (its contract end, or the end of the month without a contract).
ALTER TABLE tenants ADD COLUMN pending_tier text CHECK (pending_tier IS NULL OR pending_tier IN ('starter', 'business', 'enterprise'));
ALTER TABLE tenants ADD COLUMN pending_tier_on date;
ALTER TABLE tenants ADD COLUMN pending_tier_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE tenants DROP COLUMN IF EXISTS pending_tier_by, DROP COLUMN IF EXISTS pending_tier_on, DROP COLUMN IF EXISTS pending_tier;
