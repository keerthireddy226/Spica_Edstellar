-- Up Migration
-- Assessment quality: settings staff can change, how often each question has
-- been used in real tests, the learner's first language (for the speaking
-- fairness study), and appeals against a real test's result.
CREATE TABLE assessment_settings (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO assessment_settings (key, value) VALUES
  ('level_pass_overall', 70),
  ('level_skill_min', 50),
  ('level_retake_days', 7),
  -- A question used in this many real tests is kept out of new ones while others are available.
  ('exposure_cap', 40),
  ('appeal_days', 14);

ALTER TABLE items ADD COLUMN certified_exposures integer NOT NULL DEFAULT 0;
ALTER TABLE participant_profiles ADD COLUMN first_language text;

CREATE TABLE result_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  reason text NOT NULL,
  -- open; upheld (the result stands); changed (re-marked, a new certificate); new_attempt (a free retake).
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'changed', 'new_attempt')),
  decision_note text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_result_appeals_open ON result_appeals(created_at) WHERE status = 'open';

-- Down Migration
DROP TABLE IF EXISTS result_appeals;
ALTER TABLE participant_profiles DROP COLUMN IF EXISTS first_language;
ALTER TABLE items DROP COLUMN IF EXISTS certified_exposures;
DROP TABLE IF EXISTS assessment_settings;
