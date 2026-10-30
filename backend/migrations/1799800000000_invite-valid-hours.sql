-- Up Migration
-- Invitation links are valid for hours (default 4), not days. Existing
-- batches keep their length, in hours.
ALTER TABLE recruitment_jobs ADD COLUMN invite_valid_hours integer NOT NULL DEFAULT 4 CHECK (invite_valid_hours BETWEEN 1 AND 1440);
UPDATE recruitment_jobs SET invite_valid_hours = least(invite_valid_days * 24, 1440);

-- Down Migration
ALTER TABLE recruitment_jobs DROP COLUMN invite_valid_hours;
