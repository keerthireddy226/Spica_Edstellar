-- Up Migration
-- Buying a product online (Full access, preparation + assessment, an
-- assessment, a level test), priced per currency.
CREATE TABLE product_prices (
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  currency text NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD')),
  -- Minor units (paise, cents, fils).
  amount integer NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (product_id, currency)
);

-- Starting prices; INR from the product list, the others rounded from it.
INSERT INTO product_prices (product_id, currency, amount)
SELECT p.id, 'INR', p.price_paise FROM products p;
INSERT INTO product_prices (product_id, currency, amount) VALUES
  ('full_access', 'USD', 9900), ('full_access', 'EUR', 9200), ('full_access', 'GBP', 7900), ('full_access', 'AED', 36500), ('full_access', 'SGD', 13500),
  ('prep_fourSkills', 'USD', 5900), ('prep_fourSkills', 'EUR', 5500), ('prep_fourSkills', 'GBP', 4700), ('prep_fourSkills', 'AED', 21900), ('prep_fourSkills', 'SGD', 7900),
  ('prep_speakingListening', 'USD', 4700), ('prep_speakingListening', 'EUR', 4400), ('prep_speakingListening', 'GBP', 3700), ('prep_speakingListening', 'AED', 17500), ('prep_speakingListening', 'SGD', 6300),
  ('prep_writing', 'USD', 4700), ('prep_writing', 'EUR', 4400), ('prep_writing', 'GBP', 3700), ('prep_writing', 'AED', 17500), ('prep_writing', 'SGD', 6300),
  ('prep_professional', 'USD', 7100), ('prep_professional', 'EUR', 6600), ('prep_professional', 'GBP', 5600), ('prep_professional', 'AED', 25900), ('prep_professional', 'SGD', 9500),
  ('assess_fourSkills', 'USD', 1800), ('assess_fourSkills', 'EUR', 1700), ('assess_fourSkills', 'GBP', 1400), ('assess_fourSkills', 'AED', 6600), ('assess_fourSkills', 'SGD', 2400),
  ('assess_speakingListening', 'USD', 1200), ('assess_speakingListening', 'EUR', 1100), ('assess_speakingListening', 'GBP', 1000), ('assess_speakingListening', 'AED', 4400), ('assess_speakingListening', 'SGD', 1600),
  ('assess_writing', 'USD', 1200), ('assess_writing', 'EUR', 1100), ('assess_writing', 'GBP', 1000), ('assess_writing', 'AED', 4400), ('assess_writing', 'SGD', 1600),
  ('assess_professional', 'USD', 2400), ('assess_professional', 'EUR', 2200), ('assess_professional', 'GBP', 1900), ('assess_professional', 'AED', 8800), ('assess_professional', 'SGD', 3200),
  ('assess_placement', 'USD', 600), ('assess_placement', 'EUR', 600), ('assess_placement', 'GBP', 500), ('assess_placement', 'AED', 2200), ('assess_placement', 'SGD', 800),
  ('level_test', 'USD', 1000), ('level_test', 'EUR', 900), ('level_test', 'GBP', 800), ('level_test', 'AED', 3500), ('level_test', 'SGD', 1300);

ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_kind_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_kind_check CHECK (kind IN ('org_licenses', 'individual_plan', 'product'));
ALTER TABLE payment_orders ADD COLUMN product_id text REFERENCES products(id);
-- A level test's level, chosen when buying.
ALTER TABLE payment_orders ADD COLUMN level text CHECK (level IS NULL OR level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'));
-- Credit for the unused part of a preparation purchase, when upgrading to Full access.
ALTER TABLE payment_orders ADD COLUMN credit_amount integer NOT NULL DEFAULT 0;
ALTER TABLE payment_orders ADD COLUMN entitlement_id uuid REFERENCES entitlements(id) ON DELETE SET NULL;
-- The order an entitlement was bought with (for upgrade credit).
ALTER TABLE entitlements ADD COLUMN order_id uuid REFERENCES payment_orders(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE entitlements DROP COLUMN IF EXISTS order_id;
ALTER TABLE payment_orders DROP COLUMN IF EXISTS entitlement_id, DROP COLUMN IF EXISTS credit_amount, DROP COLUMN IF EXISTS level, DROP COLUMN IF EXISTS product_id;
DELETE FROM payment_orders WHERE kind = 'product';
ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_kind_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_kind_check CHECK (kind IN ('org_licenses', 'individual_plan'));
DROP TABLE IF EXISTS product_prices;
