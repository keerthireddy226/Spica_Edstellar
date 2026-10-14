-- Up Migration
-- 1. A durable job queue in Postgres. Work survives restarts, failed jobs
--    retry with backoff, and any number of API instances can share the load
--    (FOR UPDATE SKIP LOCKED) without doing a job twice.
CREATE TABLE job_queue (
  id bigserial PRIMARY KEY,
  queue text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  -- Same key = same job; used for periodic work so each time slot runs once.
  dedupe_key text UNIQUE,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX idx_job_queue_ready ON job_queue(run_at) WHERE status = 'queued';
CREATE INDEX idx_job_queue_running ON job_queue(locked_at) WHERE status = 'running';
CREATE INDEX idx_job_queue_finished ON job_queue(finished_at) WHERE status IN ('done', 'failed');

-- 2. Daily learning activity per learner (UTC days). Analytics read this
--    instead of scanning every session and attempt on each page load.
CREATE TABLE learner_activity_daily (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  -- Genuinely completed sessions (not skipped through).
  sessions integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  active_ms bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX idx_learner_activity_daily_day ON learner_activity_daily(day);
CREATE INDEX idx_learner_activity_daily_tenant ON learner_activity_daily(tenant_id, day);

-- Down Migration
DROP TABLE IF EXISTS learner_activity_daily;
DROP TABLE IF EXISTS job_queue;
