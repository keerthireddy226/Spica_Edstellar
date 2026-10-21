-- Up Migration
-- The real assessment attempt: a strictly proctored, one-attempt run of a test
-- that uses up an owned attempt (certified), and the free short sample of the
-- same test that people buying only the assessment take first (sample).
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_delivery_mode_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_delivery_mode_check CHECK (delivery_mode IN ('practice', 'mock', 'certified', 'sample'));
-- The purchase a certified attempt (or a sample) belongs to.
ALTER TABLE sessions ADD COLUMN entitlement_id uuid REFERENCES entitlements(id) ON DELETE SET NULL;
CREATE INDEX idx_sessions_entitlement ON sessions(entitlement_id) WHERE entitlement_id IS NOT NULL;

-- Result certificates: one per certified attempt, issued when proctoring found
-- no problem (or a reviewer cleared it), valid for a year.
ALTER TABLE certificates ADD COLUMN kind text NOT NULL DEFAULT 'completion' CHECK (kind IN ('completion', 'result'));
ALTER TABLE certificates ADD COLUMN session_id uuid UNIQUE REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE certificates ADD COLUMN test_type_id text REFERENCES test_types(id);
ALTER TABLE certificates ADD COLUMN test_name text;
ALTER TABLE certificates ADD COLUMN spica_score integer;
-- { speaking: { level, score }, ... }
ALTER TABLE certificates ADD COLUMN skill_scores jsonb;
ALTER TABLE certificates ADD COLUMN valid_until date;
-- One completion certificate per learner per batch; result certificates are per attempt.
ALTER TABLE certificates DROP CONSTRAINT IF EXISTS certificates_user_id_batch_id_key;
CREATE UNIQUE INDEX certificates_completion_user_batch ON certificates(user_id, batch_id) WHERE kind = 'completion';

-- Down Migration
DROP INDEX IF EXISTS certificates_completion_user_batch;
DELETE FROM certificates WHERE kind = 'result';
ALTER TABLE certificates ADD CONSTRAINT certificates_user_id_batch_id_key UNIQUE (user_id, batch_id);
ALTER TABLE certificates DROP COLUMN IF EXISTS valid_until, DROP COLUMN IF EXISTS skill_scores, DROP COLUMN IF EXISTS spica_score,
  DROP COLUMN IF EXISTS test_name, DROP COLUMN IF EXISTS test_type_id, DROP COLUMN IF EXISTS session_id, DROP COLUMN IF EXISTS kind;
DROP INDEX IF EXISTS idx_sessions_entitlement;
ALTER TABLE sessions DROP COLUMN IF EXISTS entitlement_id;
UPDATE sessions SET delivery_mode = 'mock' WHERE delivery_mode IN ('certified', 'sample');
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_delivery_mode_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_delivery_mode_check CHECK (delivery_mode IN ('practice', 'mock'));
