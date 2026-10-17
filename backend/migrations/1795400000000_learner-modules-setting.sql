-- Up Migration
-- An organization can switch off Modules for its learners (e.g. an
-- engagement that only covers practice tests and mock exams).
ALTER TABLE tenants ADD COLUMN learner_modules boolean NOT NULL DEFAULT true;

-- Down Migration
ALTER TABLE tenants DROP COLUMN IF EXISTS learner_modules;
