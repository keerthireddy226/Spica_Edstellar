-- Up Migration
-- Practice sets, mock tests and real tests never share questions (owner decision
-- 2026-10-22). Each exams row says which bank it belongs to: today's sets stay
-- 'practice'; the mock bank and the real-test bank are extra rows of their own.
ALTER TABLE exams ADD COLUMN purpose text NOT NULL DEFAULT 'practice'
  CHECK (purpose IN ('practice', 'mock', 'assessment'));
CREATE INDEX exams_test_type_purpose_idx ON exams (test_type_id, purpose);

-- Down Migration
DROP INDEX IF EXISTS exams_test_type_purpose_idx;
ALTER TABLE exams DROP COLUMN IF EXISTS purpose;
