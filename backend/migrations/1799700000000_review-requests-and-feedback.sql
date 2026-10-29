-- Up Migration
-- Score reviews for every test (not only the final assessment): a "concern"
-- for practice and mock tests, a "review" for placement and real tests. One
-- shared queue for Edstellar staff: claimed by one reviewer, escalated to the
-- Super Admin when it waits too long. A recruiter can ask for a candidate.
ALTER TABLE result_appeals
  ADD COLUMN kind text NOT NULL DEFAULT 'review' CHECK (kind IN ('review', 'concern')),
  ADD COLUMN assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN filed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN escalated_at timestamptz;
ALTER TABLE result_appeals DROP CONSTRAINT result_appeals_status_check;
ALTER TABLE result_appeals ADD CONSTRAINT result_appeals_status_check CHECK (status IN ('open', 'upheld', 'changed', 'new_attempt', 'noted'));

-- A short, optional form after every test.
CREATE TABLE test_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  skipped boolean NOT NULL DEFAULT false,
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  smooth boolean,
  issues text[] NOT NULL DEFAULT '{}',
  recommend smallint CHECK (recommend BETWEEN 0 AND 10),
  suggestion text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_test_feedback_created ON test_feedback(created_at);

-- Down Migration
DROP TABLE IF EXISTS test_feedback;
DELETE FROM result_appeals WHERE status = 'noted';
ALTER TABLE result_appeals DROP CONSTRAINT result_appeals_status_check;
ALTER TABLE result_appeals ADD CONSTRAINT result_appeals_status_check CHECK (status IN ('open', 'upheld', 'changed', 'new_attempt'));
ALTER TABLE result_appeals DROP COLUMN escalated_at, DROP COLUMN filed_by, DROP COLUMN assigned_at, DROP COLUMN assigned_to, DROP COLUMN kind;
