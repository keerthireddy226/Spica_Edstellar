-- Up Migration
-- Extras for a final assessment's certificate: 12 more months of validity,
-- lifetime validity, or a printed copy posted to the learner.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('full', 'prep', 'assessment', 'level', 'pack', 'final', 'cert_extend', 'cert_lifetime', 'cert_print'));
INSERT INTO products (id, kind, test_type_id, name, description, price_paise, credits, duration_days, attempts, sort_order) VALUES
  ('cert_extend', 'cert_extend', NULL, 'Certificate: 12 more months', 'Keeps a final assessment certificate valid for 12 more months.', 49900, NULL, 1, 0, 300),
  ('cert_lifetime', 'cert_lifetime', NULL, 'Certificate: lifetime validity', 'A final assessment certificate that never expires.', 149900, NULL, 1, 0, 301),
  ('cert_print', 'cert_print', NULL, 'Printed certificate', 'A printed copy of a final assessment certificate, posted to you.', 99900, NULL, 1, 0, 302);
INSERT INTO product_prices (product_id, currency, amount) VALUES
  ('cert_extend', 'INR', 49900), ('cert_extend', 'USD', 900), ('cert_extend', 'EUR', 800), ('cert_extend', 'GBP', 700), ('cert_extend', 'AED', 3300), ('cert_extend', 'SGD', 1200),
  ('cert_lifetime', 'INR', 149900), ('cert_lifetime', 'USD', 2500), ('cert_lifetime', 'EUR', 2300), ('cert_lifetime', 'GBP', 1900), ('cert_lifetime', 'AED', 9200), ('cert_lifetime', 'SGD', 3400),
  ('cert_print', 'INR', 99900), ('cert_print', 'USD', 1900), ('cert_print', 'EUR', 1800), ('cert_print', 'GBP', 1500), ('cert_print', 'AED', 7000), ('cert_print', 'SGD', 2600);

-- The certificate an extra is for, and where a printed copy goes.
ALTER TABLE payment_orders ADD COLUMN certificate_id uuid REFERENCES certificates(id) ON DELETE SET NULL;
ALTER TABLE payment_orders ADD COLUMN shipping jsonb;

-- Printed copies to post, for Spica staff.
CREATE TABLE certificate_prints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  order_id uuid REFERENCES payment_orders(id) ON DELETE SET NULL,
  shipping jsonb NOT NULL,
  status text NOT NULL DEFAULT 'to_print' CHECK (status IN ('to_print', 'posted')),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS certificate_prints;
ALTER TABLE payment_orders DROP COLUMN IF EXISTS shipping, DROP COLUMN IF EXISTS certificate_id;
DELETE FROM product_prices WHERE product_id IN ('cert_extend', 'cert_lifetime', 'cert_print');
DELETE FROM products WHERE id IN ('cert_extend', 'cert_lifetime', 'cert_print');
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('full', 'prep', 'assessment', 'level', 'pack', 'final'));
