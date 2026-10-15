-- Up Migration
-- Recruitment: an organization buys employee skills (the learning product),
-- recruitment (one-off candidate assessments), or both. Recruiters invite
-- candidates to a job opening; each candidate gets one proctored test
-- through an emailed link and no learning app. Assessments are paid for
-- with credits.

ALTER TABLE tenants
  ADD COLUMN products text[] NOT NULL DEFAULT '{skills}',
  -- Proctoring for candidates, separate from the employees' policy.
  ADD COLUMN recruitment_proctoring jsonb,
  -- USD cents per assessment; null = the rate card.
  ADD COLUMN assessment_price_cents integer,
  -- Candidate data is erased this many days after the hiring decision.
  ADD COLUMN candidate_retention_days integer NOT NULL DEFAULT 180;
ALTER TABLE tenants ADD CONSTRAINT tenants_products_check
  CHECK (cardinality(products) >= 1 AND products <@ ARRAY['skills', 'recruitment']::text[]);

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['learner'::text, 'org_admin'::text, 'admin'::text, 'super_admin'::text, 'manager'::text, 'recruiter'::text, 'candidate'::text]));
ALTER TABLE users DROP CONSTRAINT tenant_required_by_role;
ALTER TABLE users ADD CONSTRAINT tenant_required_by_role
  CHECK ((role = ANY (ARRAY['learner'::text, 'org_admin'::text, 'manager'::text, 'recruiter'::text, 'candidate'::text]) AND tenant_id IS NOT NULL)
    OR role = ANY (ARRAY['admin'::text, 'super_admin'::text]));

ALTER TABLE tenant_plan_events DROP CONSTRAINT tenant_plan_events_kind_check;
ALTER TABLE tenant_plan_events ADD CONSTRAINT tenant_plan_events_kind_check
  CHECK (kind IN ('tier_change', 'price_change', 'pilot_started', 'pilot_ended', 'enterprise_inquiry', 'products_changed', 'credits_granted', 'assessment_price_change'));

CREATE TABLE recruitment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  department text,
  location text,
  description text,
  -- 'placement' (adaptive CEFR test) or a practice-test product id.
  test_kind text NOT NULL CHECK (test_kind IN ('placement', 'fourSkills', 'speakingListening', 'writing', 'professional')),
  min_cefr text CHECK (min_cefr IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  invite_valid_days integer NOT NULL DEFAULT 7 CHECK (invite_valid_days BETWEEN 1 AND 60),
  show_result_to_candidate boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX idx_recruitment_jobs_tenant ON recruitment_jobs (tenant_id, status, created_at DESC);

CREATE TABLE recruitment_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES recruitment_jobs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text,
  last_name text,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'started', 'completed', 'expired', 'cancelled')),
  -- For a practice-test product: the exam set this candidate takes.
  exam_id uuid REFERENCES exams(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  result jsonb,
  decision text CHECK (decision IN ('shortlisted', 'rejected', 'hired')),
  decision_note text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reminder_sent_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  credit_refunded boolean NOT NULL DEFAULT false
);
-- One live invitation per person per job opening.
CREATE UNIQUE INDEX uq_recruitment_assessment_job_email ON recruitment_assessments (job_id, lower(email)) WHERE status <> 'cancelled';
CREATE INDEX idx_recruitment_assessments_job ON recruitment_assessments (job_id, status);
CREATE INDEX idx_recruitment_assessments_candidate ON recruitment_assessments (candidate_id);
CREATE INDEX idx_recruitment_assessments_open ON recruitment_assessments (expires_at) WHERE status IN ('invited', 'started');

-- Credits: one per invited candidate. The balance is the sum of deltas.
CREATE TABLE recruitment_credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('grant', 'purchase', 'invite', 'refund', 'adjustment')),
  assessment_id uuid REFERENCES recruitment_assessments(id) ON DELETE SET NULL,
  note text,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recruitment_credit_events_tenant ON recruitment_credit_events (tenant_id, created_at DESC);

-- Down Migration
DROP TABLE recruitment_credit_events;
DROP TABLE recruitment_assessments;
DROP TABLE recruitment_jobs;
ALTER TABLE tenant_plan_events DROP CONSTRAINT tenant_plan_events_kind_check;
DELETE FROM tenant_plan_events WHERE kind IN ('products_changed', 'credits_granted', 'assessment_price_change');
ALTER TABLE tenant_plan_events ADD CONSTRAINT tenant_plan_events_kind_check
  CHECK (kind IN ('tier_change', 'price_change', 'pilot_started', 'pilot_ended', 'enterprise_inquiry'));
DELETE FROM users WHERE role IN ('recruiter', 'candidate');
ALTER TABLE users DROP CONSTRAINT tenant_required_by_role;
ALTER TABLE users ADD CONSTRAINT tenant_required_by_role
  CHECK ((role = ANY (ARRAY['learner'::text, 'org_admin'::text, 'manager'::text]) AND tenant_id IS NOT NULL)
    OR role = ANY (ARRAY['admin'::text, 'super_admin'::text]));
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['learner'::text, 'org_admin'::text, 'admin'::text, 'super_admin'::text, 'manager'::text]));
ALTER TABLE tenants DROP CONSTRAINT tenants_products_check;
ALTER TABLE tenants DROP COLUMN candidate_retention_days, DROP COLUMN assessment_price_cents, DROP COLUMN recruitment_proctoring, DROP COLUMN products;
