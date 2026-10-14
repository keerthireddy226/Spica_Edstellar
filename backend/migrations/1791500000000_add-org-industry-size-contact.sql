-- Up Migration
-- Onboard Organization form grows a few more questions: industry, expected
-- learner count, and a contact phone number for the org admin contact.

ALTER TABLE tenants ADD COLUMN industry text;
ALTER TABLE tenants ADD COLUMN expected_learner_count integer;
ALTER TABLE users ADD COLUMN phone text;

-- Down Migration
ALTER TABLE tenants DROP COLUMN industry;
ALTER TABLE tenants DROP COLUMN expected_learner_count;
ALTER TABLE users DROP COLUMN phone;
