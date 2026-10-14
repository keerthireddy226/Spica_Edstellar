-- Up Migration
-- Fuller organization profile, filled in by the Org Admin after onboarding
-- (the Admin's onboarding form only captures the essentials).

ALTER TABLE tenants ADD COLUMN legal_name text;
ALTER TABLE tenants ADD COLUMN website text;
ALTER TABLE tenants ADD COLUMN phone text;
ALTER TABLE tenants ADD COLUMN address_line text;
ALTER TABLE tenants ADD COLUMN city text;
ALTER TABLE tenants ADD COLUMN state text;
ALTER TABLE tenants ADD COLUMN postal_code text;
ALTER TABLE tenants ADD COLUMN employee_count_band text
  CHECK (employee_count_band IS NULL OR employee_count_band IN ('1_50', '51_200', '201_1000', '1001_5000', '5000_plus'));
ALTER TABLE tenants ADD COLUMN training_goal text;
ALTER TABLE tenants ADD COLUMN billing_contact_phone text;
ALTER TABLE tenants ADD COLUMN purchase_order_ref text;

-- The Org Admin's own role at their organization.
ALTER TABLE users ADD COLUMN job_title text;

-- Down Migration
ALTER TABLE users DROP COLUMN job_title;
ALTER TABLE tenants DROP COLUMN legal_name, DROP COLUMN website, DROP COLUMN phone, DROP COLUMN address_line,
  DROP COLUMN city, DROP COLUMN state, DROP COLUMN postal_code, DROP COLUMN employee_count_band,
  DROP COLUMN training_goal, DROP COLUMN billing_contact_phone, DROP COLUMN purchase_order_ref;
