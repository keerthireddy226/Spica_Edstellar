-- Up Migration
-- A learner in an organization can ask its admins for more time (months of
-- access); approving assigns the months to the learner.
ALTER TABLE license_requests DROP CONSTRAINT license_requests_kind_check;
ALTER TABLE license_requests ADD CONSTRAINT license_requests_kind_check
  CHECK (kind IN ('increase_allotment', 'decrease_allotment', 'unassign_learner', 'learner_extension'));

-- Down Migration
DELETE FROM license_requests WHERE kind = 'learner_extension';
ALTER TABLE license_requests DROP CONSTRAINT license_requests_kind_check;
ALTER TABLE license_requests ADD CONSTRAINT license_requests_kind_check
  CHECK (kind IN ('increase_allotment', 'decrease_allotment', 'unassign_learner'));
