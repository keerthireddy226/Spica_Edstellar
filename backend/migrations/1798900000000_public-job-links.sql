-- Up Migration
-- One public link per job opening, to post on job websites or a careers page.
-- Anyone with the link confirms their email with a code and takes the test;
-- the job's credits are used when they start, not when the link is shared.
ALTER TABLE recruitment_jobs
  ADD COLUMN public_slug text UNIQUE,
  ADD COLUMN public_link_enabled boolean NOT NULL DEFAULT false,
  -- At most this many people can start through the link (null: no limit).
  ADD COLUMN public_link_max integer CHECK (public_link_max IS NULL OR public_link_max BETWEEN 1 AND 10000),
  -- The link stops taking people after this time (null: while the job is open).
  ADD COLUMN public_link_closes_at timestamptz;

-- How a candidate arrived: an emailed invitation, or the job's public link.
ALTER TABLE recruitment_assessments
  ADD COLUMN source text NOT NULL DEFAULT 'invite' CHECK (source IN ('invite', 'public_link'));

-- One-time codes that confirm an email before someone starts through a public link.
CREATE TABLE recruitment_apply_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES recruitment_jobs(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text,
  last_name text,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recruitment_apply_codes_lookup ON recruitment_apply_codes (job_id, lower(email), created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS recruitment_apply_codes;
ALTER TABLE recruitment_assessments DROP COLUMN IF EXISTS source;
ALTER TABLE recruitment_jobs
  DROP COLUMN IF EXISTS public_link_closes_at,
  DROP COLUMN IF EXISTS public_link_max,
  DROP COLUMN IF EXISTS public_link_enabled,
  DROP COLUMN IF EXISTS public_slug;
