-- Up Migration
-- 1. A learner's real Versant result, entered after the actual test, with the
--    score report as proof. The certificate shows it only once an admin has
--    checked the proof (when they issue the certificate).
CREATE TABLE versant_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam text NOT NULL DEFAULT 'versant_4_skills',
  taken_on date NOT NULL,
  overall_level text NOT NULL CHECK (overall_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  overall_score integer CHECK (overall_score IS NULL OR overall_score BETWEEN 10 AND 90),
  -- {"listening": {"level": "B2", "score": 61}, ...}; any skill may be missing.
  skill_levels jsonb NOT NULL DEFAULT '{}',
  proof_path text,
  proof_type text,
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_versant_results_user ON versant_results(user_id, created_at DESC);

-- 2. Certificate requests: an org learner's goes to their org admins, an
--    individual's to Spica staff. One open request at a time.
CREATE TABLE certificate_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  reviewer text NOT NULL CHECK (reviewer IN ('org', 'staff')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'declined')),
  -- What the learner had done when they asked (tests, levels, dates).
  snapshot jsonb NOT NULL DEFAULT '{}',
  versant_result_id uuid REFERENCES versant_results(id) ON DELETE SET NULL,
  certificate_id uuid REFERENCES certificates(id) ON DELETE SET NULL,
  decision_note text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX certificate_requests_one_pending ON certificate_requests(user_id) WHERE status = 'pending';
CREATE INDEX idx_certificate_requests_queue ON certificate_requests(reviewer, tenant_id, status, created_at DESC);

-- 3. What a course certificate says: the period, the goal, the level reached
--    in Spica and, when checked, the real Versant result.
ALTER TABLE certificates
  ADD COLUMN course_name text,
  ADD COLUMN period_from date,
  ADD COLUMN period_to date,
  ADD COLUMN goal_level text,
  ADD COLUMN versant_level text,
  ADD COLUMN versant_score integer,
  ADD COLUMN versant_taken_on date;

-- 4. When the test plan's dates were last emailed as calendar events.
ALTER TABLE participant_profiles ADD COLUMN test_dates_emailed_at timestamptz;

-- Down Migration
ALTER TABLE participant_profiles DROP COLUMN IF EXISTS test_dates_emailed_at;
ALTER TABLE certificates
  DROP COLUMN IF EXISTS versant_taken_on,
  DROP COLUMN IF EXISTS versant_score,
  DROP COLUMN IF EXISTS versant_level,
  DROP COLUMN IF EXISTS goal_level,
  DROP COLUMN IF EXISTS period_to,
  DROP COLUMN IF EXISTS period_from,
  DROP COLUMN IF EXISTS course_name;
DROP TABLE IF EXISTS certificate_requests;
DROP TABLE IF EXISTS versant_results;
