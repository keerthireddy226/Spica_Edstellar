-- Up Migration
-- Where Edstellar staff and Managers work, for onboarding and contact.
ALTER TABLE users
  ADD COLUMN region text,
  ADD COLUMN city text,
  ADD COLUMN country text,
  ADD COLUMN staff_notes text;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS staff_notes, DROP COLUMN IF EXISTS country, DROP COLUMN IF EXISTS city, DROP COLUMN IF EXISTS region;
