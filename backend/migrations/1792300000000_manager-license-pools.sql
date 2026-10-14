-- Up Migration
-- Allotments become reservations carved out of the org pool:
--  * batches.license_budget  = licenses fixed to that batch
--  * users.license_allotment = a Manager's own pool, usable in any batch they manage
-- Every assignment records which of these it was drawn from, so each
-- source's "used" count is exact and the unreserved remainder is known.

ALTER TABLE users ADD COLUMN license_allotment integer CHECK (license_allotment IS NULL OR license_allotment >= 0);

ALTER TABLE license_assignments ADD COLUMN source text NOT NULL DEFAULT 'org' CHECK (source IN ('org', 'batch', 'manager'));
ALTER TABLE license_assignments ADD COLUMN source_manager_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_license_assignments_source ON license_assignments(source, batch_id, source_manager_id) WHERE reclaimed_at IS NULL;

-- Existing assignments in a batch that has an allotment were made against it.
UPDATE license_assignments a SET source = 'batch'
FROM batches b
WHERE b.id = a.batch_id AND b.license_budget IS NOT NULL;

ALTER TABLE license_events DROP CONSTRAINT license_events_kind_check;
ALTER TABLE license_events ADD CONSTRAINT license_events_kind_check
  CHECK (kind IN ('purchase', 'credit', 'comp', 'assign', 'extend', 'reclaim', 'budget', 'request', 'manager_allotment'));

-- Down Migration
ALTER TABLE license_events DROP CONSTRAINT license_events_kind_check;
ALTER TABLE license_events ADD CONSTRAINT license_events_kind_check
  CHECK (kind IN ('purchase', 'credit', 'comp', 'assign', 'extend', 'reclaim', 'budget', 'request'));
DROP INDEX idx_license_assignments_source;
ALTER TABLE license_assignments DROP COLUMN source_manager_id, DROP COLUMN source;
ALTER TABLE users DROP COLUMN license_allotment;
