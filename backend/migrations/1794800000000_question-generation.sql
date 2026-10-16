-- Up Migration
-- Question generation pipeline (ASSESSMENT_ENGINE.md section 6): generation
-- jobs, automatic checks, a human review queue, and approval for mocks.

-- One request: N questions of one type and level (and field), for a test type.
CREATE TABLE generation_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_type_id  text NOT NULL REFERENCES test_types(id),
  item_type_id  text NOT NULL REFERENCES item_types(id),
  cefr_level    text NOT NULL CHECK (cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  domain        text NOT NULL DEFAULT 'general' CHECK (domain IN ('general', 'banking', 'bpo', 'it', 'insurance', 'healthcare')),
  requested     integer NOT NULL CHECK (requested BETWEEN 1 AND 50),
  produced      integer NOT NULL DEFAULT 0,
  passed        integer NOT NULL DEFAULT 0,
  failed        integer NOT NULL DEFAULT 0,
  model         text,
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error         text,
  -- Updated while a job runs; a running job silent for long was interrupted (a restart) and is resumed.
  heartbeat_at  timestamptz,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX idx_generation_jobs_created ON generation_jobs(created_at DESC);

ALTER TABLE items ADD COLUMN generation_job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN domain text NOT NULL DEFAULT 'general';
-- Why each option is right or wrong, and where the answer is (made with the
-- question; used by the feedback report).
ALTER TABLE items ADD COLUMN explanation jsonb;
-- For near-duplicate checks (gemini-embedding-001); no pgvector here, so
-- similarity is computed in the app.
ALTER TABLE items ADD COLUMN embedding real[];
-- Mock exams use only questions a person approved for them.
ALTER TABLE items ADD COLUMN mock_approved boolean NOT NULL DEFAULT false;
-- Waiting for a person: a failed check, wanted for mocks, or statistics that
-- look wrong. NULL = nothing to review.
ALTER TABLE items ADD COLUMN review_state text CHECK (review_state IN ('needs_review', 'rejected'));
ALTER TABLE items ADD COLUMN review_reason text;
ALTER TABLE items ADD COLUMN reviewed_at timestamptz;
CREATE INDEX idx_items_review ON items(review_state) WHERE review_state IS NOT NULL;
-- Approved questions not yet placed in a set, by type.
CREATE INDEX idx_items_unplaced ON items(item_type_id, cefr_level) WHERE exam_part_id IS NULL AND status = 'approved';

-- Questions in use before review existed keep their place in mocks; a
-- reviewer can find them under "approved before review" and retire any.
UPDATE items SET mock_approved = true, review_decision = coalesce(review_decision, 'grandfathered') WHERE status = 'approved';

-- Down Migration
DROP INDEX IF EXISTS idx_items_unplaced;
DROP INDEX IF EXISTS idx_items_review;
ALTER TABLE items DROP COLUMN IF EXISTS reviewed_at;
ALTER TABLE items DROP COLUMN IF EXISTS review_reason;
ALTER TABLE items DROP COLUMN IF EXISTS review_state;
ALTER TABLE items DROP COLUMN IF EXISTS mock_approved;
ALTER TABLE items DROP COLUMN IF EXISTS embedding;
ALTER TABLE items DROP COLUMN IF EXISTS explanation;
ALTER TABLE items DROP COLUMN IF EXISTS domain;
ALTER TABLE items DROP COLUMN IF EXISTS generation_job_id;
DROP TABLE IF EXISTS generation_jobs;
