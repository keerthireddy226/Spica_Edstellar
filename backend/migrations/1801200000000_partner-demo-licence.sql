-- Up Migration
-- Channel Partners stage 3: a demo licence is a 7-day preparation for English
-- 4 Skills Essentials with no real test (attempts 0): Practice Modules of its
-- question types, 2 practice tests and 1 mock test; no final assessment and no
-- certificate. Not sold (inactive product); given by partner organisations.
INSERT INTO products (id, kind, test_type_id, name, description, price_paise, duration_days, attempts, active, sort_order)
VALUES ('partner_demo', 'prep', 'fourSkills', 'Partner demo: English 4 Skills Essentials (7 days)',
  'Free demo from a Channel Partner: Practice Modules, 2 practice tests and 1 mock test. No certificate.', 0, 7, 0, false, 999)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE entitlements DROP CONSTRAINT entitlements_source_check;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_source_check CHECK (source = ANY (ARRAY['purchase'::text, 'credit'::text, 'grant'::text, 'included'::text, 'partner_demo'::text]));
CREATE INDEX idx_entitlements_partner_demo ON entitlements (tenant_id) WHERE source = 'partner_demo';

-- Down Migration
DROP INDEX IF EXISTS idx_entitlements_partner_demo;
DELETE FROM entitlements WHERE source = 'partner_demo';
ALTER TABLE entitlements DROP CONSTRAINT entitlements_source_check;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_source_check CHECK (source = ANY (ARRAY['purchase'::text, 'credit'::text, 'grant'::text, 'included'::text]));
DELETE FROM products WHERE id = 'partner_demo';
