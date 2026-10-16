-- Up Migration
-- One-click "Create the test": a built test can wait for AI-written questions
-- to fill its gaps, then complete (and publish) itself.
ALTER TABLE forms ADD COLUMN build_status text NOT NULL DEFAULT 'ready' CHECK (build_status IN ('ready', 'waiting_for_ai', 'short'));
-- What was picked per section, from which field, what's missing and what needs approval.
ALTER TABLE forms ADD COLUMN build_summary jsonb;
ALTER TABLE forms ADD COLUMN generation_job_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE forms ADD COLUMN publish_when_ready boolean NOT NULL DEFAULT false;
CREATE INDEX idx_forms_waiting ON forms(build_status) WHERE build_status = 'waiting_for_ai';

-- Down Migration
DROP INDEX IF EXISTS idx_forms_waiting;
ALTER TABLE forms DROP COLUMN IF EXISTS publish_when_ready;
ALTER TABLE forms DROP COLUMN IF EXISTS generation_job_ids;
ALTER TABLE forms DROP COLUMN IF EXISTS build_summary;
ALTER TABLE forms DROP COLUMN IF EXISTS build_status;
