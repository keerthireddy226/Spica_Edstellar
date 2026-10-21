-- Up Migration
-- Full access in USD matches the monthly plan's price on Plans ($100).
UPDATE product_prices SET amount = 10000 WHERE product_id = 'full_access' AND currency = 'USD';

-- Down Migration
UPDATE product_prices SET amount = 9900 WHERE product_id = 'full_access' AND currency = 'USD';
