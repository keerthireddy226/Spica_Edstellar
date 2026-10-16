-- Up Migration
-- Universities (ASSESSMENT_ENGINE.md section 8, Phase 7). A university's
-- skills product is Campus (students learning towards a target); its
-- recruitment product is Admissions (applicants take an admission test).

-- Admissions decisions, alongside recruitment's.
ALTER TABLE recruitment_assessments DROP CONSTRAINT recruitment_assessments_decision_check;
ALTER TABLE recruitment_assessments ADD CONSTRAINT recruitment_assessments_decision_check
  CHECK (decision IN ('shortlisted', 'rejected', 'hired', 'admitted', 'waitlisted', 'declined'));

-- The human review step: an admissions officer confirms (or corrects) the
-- level from the AI-scored test after reading the report, before deciding.
ALTER TABLE recruitment_assessments ADD COLUMN confirmed_level text CHECK (confirmed_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'));
ALTER TABLE recruitment_assessments ADD COLUMN confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE recruitment_assessments ADD COLUMN confirmed_at timestamptz;
ALTER TABLE recruitment_assessments ADD COLUMN confirm_note text;

-- Campus: a mock every two weeks (not just two a month). Admissions:
-- applicants take their admission test only.
UPDATE plan_quotas SET extras = extras || '{"mockEveryDays": 14}' WHERE segment = 'university' AND tier = 'campus';
INSERT INTO plan_quotas (segment, tier, practice_per_month, mocks_per_month, report_level, extras)
VALUES ('university', 'admissions', 0, 0, 'full', '{}') ON CONFLICT DO NOTHING;

-- Down Migration
DELETE FROM plan_quotas WHERE segment = 'university' AND tier = 'admissions';
UPDATE plan_quotas SET extras = extras - 'mockEveryDays' WHERE segment = 'university' AND tier = 'campus';
ALTER TABLE recruitment_assessments DROP COLUMN IF EXISTS confirm_note;
ALTER TABLE recruitment_assessments DROP COLUMN IF EXISTS confirmed_at;
ALTER TABLE recruitment_assessments DROP COLUMN IF EXISTS confirmed_by;
ALTER TABLE recruitment_assessments DROP COLUMN IF EXISTS confirmed_level;
ALTER TABLE recruitment_assessments DROP CONSTRAINT recruitment_assessments_decision_check;
ALTER TABLE recruitment_assessments ADD CONSTRAINT recruitment_assessments_decision_check CHECK (decision IN ('shortlisted', 'rejected', 'hired'));
