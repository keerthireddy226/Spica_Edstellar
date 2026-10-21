-- Up Migration
-- A practice pack: 30 days of Practice Modules (every question type, at the
-- learner's own level as it grows), aiming at a level they choose (their goal).
-- No practice tests, mock tests or real test. Cheaper than preparation.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('full', 'prep', 'assessment', 'level', 'pack'));
INSERT INTO products (id, kind, test_type_id, name, description, price_paise, credits, duration_days, attempts, sort_order) VALUES
  ('practice_pack', 'pack', NULL, 'Practice pack', '30 days of Practice Modules in every question type, aiming at the level you choose.', 149900, 2, 30, 0, 45);
INSERT INTO product_prices (product_id, currency, amount) VALUES
  ('practice_pack', 'INR', 149900), ('practice_pack', 'USD', 1800), ('practice_pack', 'EUR', 1700), ('practice_pack', 'GBP', 1400), ('practice_pack', 'AED', 6600), ('practice_pack', 'SGD', 2400);

-- Down Migration
DELETE FROM entitlements WHERE product_id = 'practice_pack';
DELETE FROM product_prices WHERE product_id = 'practice_pack';
DELETE FROM products WHERE id = 'practice_pack';
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('full', 'prep', 'assessment', 'level'));
