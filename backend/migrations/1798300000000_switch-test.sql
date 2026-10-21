-- Up Migration
-- Preparation for one test can be switched to another test once, free, in its first 7 days.
ALTER TABLE entitlements ADD COLUMN switched_at timestamptz;
ALTER TABLE entitlements ADD COLUMN switched_from text REFERENCES test_types(id);

-- Down Migration
ALTER TABLE entitlements DROP COLUMN IF EXISTS switched_from, DROP COLUMN IF EXISTS switched_at;
