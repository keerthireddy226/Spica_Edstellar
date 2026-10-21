-- Up Migration
-- Every paid plan includes one final assessment (a real test with a
-- certificate). Preparation and real-test products already have their
-- attempt; Full access (the Plus plan, an organization's licence or the
-- full_access product) now includes one too. The learner chooses the test
-- when they take it, so the entitlement's test_type_id stays empty until then.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('full', 'prep', 'assessment', 'level', 'pack', 'final'));
INSERT INTO products (id, kind, test_type_id, name, description, price_paise, credits, duration_days, attempts, sort_order) VALUES
  ('final_assessment', 'final', NULL, 'Final assessment', 'One real test with a certificate, included with Full access. The learner chooses the test.', 0, NULL, 30, 1, 200);

-- 'included': came with a plan (Full access), not bought or given on its own.
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_source_check;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_source_check CHECK (source IN ('purchase', 'credit', 'grant', 'included'));

-- Everyone with Full access today gets theirs, valid until 14 days after their access ends.
WITH access AS (
  SELECT user_id, tenant_id, max(ends_at) AS ends_at FROM (
    SELECT la.user_id, la.tenant_id, la.ends_at FROM license_assignments la
    WHERE la.reclaimed_at IS NULL AND la.ends_at > now()
    UNION ALL
    SELECT e.user_id, e.tenant_id, e.ends_at FROM entitlements e JOIN products p ON p.id = e.product_id
    WHERE p.kind = 'full' AND e.revoked_at IS NULL AND e.ends_at > now()
  ) a GROUP BY user_id, tenant_id
)
INSERT INTO entitlements (user_id, product_id, attempts_total, ends_at, source, tenant_id)
SELECT a.user_id, 'final_assessment', 1, a.ends_at + interval '14 days', 'included', a.tenant_id
FROM access a JOIN users u ON u.id = a.user_id AND u.role = 'learner' AND u.deleted_at IS NULL;

-- Down Migration
DELETE FROM entitlements WHERE product_id = 'final_assessment';
DELETE FROM products WHERE id = 'final_assessment';
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_source_check;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_source_check CHECK (source IN ('purchase', 'credit', 'grant'));
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('full', 'prep', 'assessment', 'level', 'pack'));
