-- Up Migration
-- Extra time for test takers with disabilities (launch plan, product gap 10.22):
-- every question's time and the whole test's time grow by this percentage.
-- Set per learner by their organisation, and per candidate invitation by the recruiter.
ALTER TABLE users ADD COLUMN extra_time_percent smallint NOT NULL DEFAULT 0 CHECK (extra_time_percent IN (0, 25, 50, 100));
ALTER TABLE recruitment_assessments ADD COLUMN extra_time_percent smallint NOT NULL DEFAULT 0 CHECK (extra_time_percent IN (0, 25, 50, 100));

-- Down Migration
ALTER TABLE recruitment_assessments DROP COLUMN extra_time_percent;
ALTER TABLE users DROP COLUMN extra_time_percent;
