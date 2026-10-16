-- Up Migration
-- Programs and monthly test limits (ASSESSMENT_ENGINE.md section 8).

-- How many practice tests and mock exams a learner can start per calendar
-- month (UTC), by segment and tier. NULL = unlimited. Edited by Super Admins.
CREATE TABLE plan_quotas (
  segment            text NOT NULL CHECK (segment IN ('individual', 'company', 'university')),
  tier               text NOT NULL,
  practice_per_month integer CHECK (practice_per_month IS NULL OR practice_per_month >= 0),
  mocks_per_month    integer CHECK (mocks_per_month IS NULL OR mocks_per_month >= 0),
  -- The AI feedback report a learner gets (Phase 5): summary or full.
  report_level       text NOT NULL DEFAULT 'full' CHECK (report_level IN ('summary', 'full')),
  extras             jsonb NOT NULL DEFAULT '{}',
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (segment, tier)
);

INSERT INTO plan_quotas (segment, tier, practice_per_month, mocks_per_month, report_level, extras) VALUES
  ('individual', 'free',       2,    1, 'summary', '{}'),
  ('individual', 'plus',       NULL, 2, 'full',    '{}'),
  ('company',    'starter',    4,    1, 'full',    '{}'),
  ('company',    'business',   NULL, 2, 'full',    '{"managerView": true}'),
  ('company',    'enterprise', NULL, 4, 'full',    '{"managerView": true, "customDomains": true, "api": true}'),
  -- One mock every two weeks.
  ('university', 'campus',     NULL, 2, 'full',    '{}');

-- A program: an organization's goal for one batch, e.g. "Customer support
-- team: LanguageCert 4 Skills B2 by 15 December". Spica plans each member's
-- practice tests and mock exams towards it (schedule_items).
CREATE TABLE programs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  use_case      text NOT NULL DEFAULT 'skills' CHECK (use_case IN ('skills')),
  domain        text NOT NULL DEFAULT 'general' CHECK (domain IN ('general', 'banking', 'bpo', 'it', 'insurance', 'healthcare')),
  test_type_id  text NOT NULL REFERENCES test_types(id),
  target_level  text NOT NULL CHECK (target_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  -- Optional per-skill targets, e.g. {"speaking": "B2"}.
  target_skills jsonb NOT NULL DEFAULT '{}',
  batch_id      uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  starts_on     date NOT NULL,
  target_date   date NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (target_date > starts_on)
);
CREATE INDEX idx_programs_tenant ON programs(tenant_id, status);
-- One active program per batch, so each learner has at most one.
CREATE UNIQUE INDEX uq_programs_active_batch ON programs(batch_id) WHERE status = 'active';

CREATE TABLE schedule_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_on     date NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('practice', 'mock')),
  status     text NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'done', 'missed')),
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  done_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_schedule_items_user ON schedule_items(user_id, status, due_on);
CREATE INDEX idx_schedule_items_program ON schedule_items(program_id, user_id);

-- A practice test's result, kept for programs (latest level) and reports.
ALTER TABLE sessions ADD COLUMN result jsonb;
ALTER TABLE sessions ADD COLUMN program_id uuid REFERENCES programs(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE sessions DROP COLUMN IF EXISTS program_id;
ALTER TABLE sessions DROP COLUMN IF EXISTS result;
DROP TABLE IF EXISTS schedule_items;
DROP TABLE IF EXISTS programs;
DROP TABLE IF EXISTS plan_quotas;
