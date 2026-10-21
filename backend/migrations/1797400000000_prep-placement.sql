-- Up Migration
-- Preparation for the English Placement test too: a month of its practice
-- tests, mock tests and Practice Modules question types, then one real test.
INSERT INTO products (id, kind, test_type_id, name, description, price_paise, credits, duration_days, attempts, sort_order) VALUES
  ('prep_placement', 'prep', 'placement', 'English Placement: preparation + assessment', 'One month of practice for this test, then one certified attempt with a certificate.', 249900, 2, 30, 1, 24);
INSERT INTO product_prices (product_id, currency, amount) VALUES
  ('prep_placement', 'INR', 249900), ('prep_placement', 'USD', 3000), ('prep_placement', 'EUR', 2800), ('prep_placement', 'GBP', 2400), ('prep_placement', 'AED', 11000), ('prep_placement', 'SGD', 4000);

-- Down Migration
DELETE FROM entitlements WHERE product_id = 'prep_placement';
DELETE FROM product_prices WHERE product_id = 'prep_placement';
DELETE FROM products WHERE id = 'prep_placement';
