-- Up Migration
-- 1. What a batch is for and how it runs, as Org Admins and Managers describe it.
ALTER TABLE batches
  ADD COLUMN description text,
  ADD COLUMN department text,
  ADD COLUMN location text,
  ADD COLUMN delivery_mode text CHECK (delivery_mode IS NULL OR delivery_mode IN ('self_paced', 'blended', 'instructor_led')),
  ADD COLUMN exam_focus text CHECK (exam_focus IS NULL OR exam_focus IN (
    'general', 'versant_four_skills', 'versant_speaking_listening', 'versant_writing', 'versant_professional', 'versant_placement',
    'ielts', 'toefl', 'pte', 'cambridge')),
  ADD COLUMN weekly_minutes_goal integer CHECK (weekly_minutes_goal IS NULL OR weekly_minutes_goal BETWEEN 10 AND 2000),
  -- Most learners the batch takes; NULL = no cap.
  ADD COLUMN capacity integer CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 10000),
  -- Months of access pre-filled when inviting learners into this batch.
  ADD COLUMN default_license_months integer CHECK (default_license_months IS NULL OR default_license_months BETWEEN 0 AND 24);

-- 2. Employee details for learners added by their organization.
ALTER TABLE users ADD COLUMN employee_id text;
CREATE UNIQUE INDEX idx_users_tenant_employee_id ON users(tenant_id, employee_id) WHERE employee_id IS NOT NULL;

-- Who filled in gender, age and location: the learner, or their organization
-- when it added them (the learner can still change it in onboarding).
ALTER TABLE participant_profiles
  ADD COLUMN demographics_source text NOT NULL DEFAULT 'self' CHECK (demographics_source IN ('self', 'organization'));

-- Down Migration
ALTER TABLE participant_profiles DROP COLUMN IF EXISTS demographics_source;
DROP INDEX IF EXISTS idx_users_tenant_employee_id;
ALTER TABLE users DROP COLUMN IF EXISTS employee_id;
ALTER TABLE batches
  DROP COLUMN IF EXISTS default_license_months,
  DROP COLUMN IF EXISTS capacity,
  DROP COLUMN IF EXISTS weekly_minutes_goal,
  DROP COLUMN IF EXISTS exam_focus,
  DROP COLUMN IF EXISTS delivery_mode,
  DROP COLUMN IF EXISTS location,
  DROP COLUMN IF EXISTS department,
  DROP COLUMN IF EXISTS description;
