-- Up Migration
-- Where each organisation's data is stored (launch plan, product gap 10.16).
-- Everyone is in Singapore today; 'eu' is for a future European copy
-- (Frankfurt), set by Spica staff when a customer needs it.
ALTER TABLE tenants ADD COLUMN data_region text NOT NULL DEFAULT 'sg' CHECK (data_region IN ('sg', 'eu'));

-- Down Migration
ALTER TABLE tenants DROP COLUMN data_region;
