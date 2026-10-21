-- Up Migration
-- An organization's credits pay for recruitment invitations (per test, from
-- the products' credit prices), for staff's real tests, and for preparation
-- for one test (per 30 days). Full access stays on licence-months.
ALTER TABLE recruitment_credit_events DROP CONSTRAINT IF EXISTS recruitment_credit_events_reason_check;
ALTER TABLE recruitment_credit_events ADD CONSTRAINT recruitment_credit_events_reason_check
  CHECK (reason IN ('grant', 'purchase', 'invite', 'refund', 'adjustment', 'assessment', 'access'));
ALTER TABLE recruitment_credit_events ADD COLUMN entitlement_id uuid REFERENCES entitlements(id) ON DELETE SET NULL;
ALTER TABLE entitlements ADD COLUMN credits_spent integer NOT NULL DEFAULT 0;
-- A real test given with credits that expired unused gives them back once.
ALTER TABLE entitlements ADD COLUMN credits_refunded boolean NOT NULL DEFAULT false;

-- Preparation for one test, per 30 days, in credits.
UPDATE products SET credits = CASE id
  WHEN 'prep_fourSkills' THEN 4 WHEN 'prep_speakingListening' THEN 3 WHEN 'prep_writing' THEN 3 WHEN 'prep_professional' THEN 5 ELSE credits END
WHERE kind = 'prep';

-- Down Migration
UPDATE products SET credits = NULL WHERE kind = 'prep';
ALTER TABLE entitlements DROP COLUMN IF EXISTS credits_refunded, DROP COLUMN IF EXISTS credits_spent;
ALTER TABLE recruitment_credit_events DROP COLUMN IF EXISTS entitlement_id;
DELETE FROM recruitment_credit_events WHERE reason IN ('assessment', 'access');
ALTER TABLE recruitment_credit_events DROP CONSTRAINT IF EXISTS recruitment_credit_events_reason_check;
ALTER TABLE recruitment_credit_events ADD CONSTRAINT recruitment_credit_events_reason_check
  CHECK (reason IN ('grant', 'purchase', 'invite', 'refund', 'adjustment'));
