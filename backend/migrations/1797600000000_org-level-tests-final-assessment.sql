-- Up Migration
-- A program can end with a final assessment: each member gets the program's
-- real test (with a certificate) this many days before the target date,
-- paid with the organization's credits.
ALTER TABLE programs ADD COLUMN final_assessment boolean NOT NULL DEFAULT false;
ALTER TABLE programs ADD COLUMN final_assessment_days integer NOT NULL DEFAULT 7 CHECK (final_assessment_days BETWEEN 1 AND 60);
-- Notified once that credits ran short for the final assessment.
ALTER TABLE programs ADD COLUMN final_assessment_short_at timestamptz;
-- The program a test was given for (its final assessment).
ALTER TABLE entitlements ADD COLUMN program_id uuid REFERENCES programs(id) ON DELETE SET NULL;
CREATE INDEX idx_entitlements_program ON entitlements(program_id) WHERE program_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_entitlements_program;
ALTER TABLE entitlements DROP COLUMN IF EXISTS program_id;
ALTER TABLE programs DROP COLUMN IF EXISTS final_assessment_short_at, DROP COLUMN IF EXISTS final_assessment_days, DROP COLUMN IF EXISTS final_assessment;
