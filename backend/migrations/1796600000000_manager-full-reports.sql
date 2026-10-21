-- Up Migration
-- Batch report: Managers see each learner's levels and scores; their full
-- score reports only when the organization turns this on.
ALTER TABLE tenants ADD COLUMN managers_see_reports boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE tenants DROP COLUMN IF EXISTS managers_see_reports;
