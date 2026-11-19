-- Up Migration
-- Demo licences given to an organisation can have their own "use by" date
-- (optional; never later than the partner's demo window). Licences not given
-- to a learner by then expire.
ALTER TABLE partner_allocations ADD COLUMN valid_until date;

-- Down Migration
ALTER TABLE partner_allocations DROP COLUMN IF EXISTS valid_until;
