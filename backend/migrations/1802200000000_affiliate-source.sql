-- Up Migration
-- The source tag on an Affiliate's link (?src=youtube) that a person signed up
-- through, for the Affiliate's "by source" track record (owner, 20 Nov 2026).
ALTER TABLE users ADD COLUMN referred_src text;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS referred_src;
