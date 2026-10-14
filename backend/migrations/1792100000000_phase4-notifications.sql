-- Up Migration
-- Phase 4: one notifications table for everything a user is told — license
-- alerts, Manager reminders, automatic nudges, daily practice reminders.
-- In-app and email share the row; dedupe_key makes every scheduled
-- notification idempotent (the job can run any number of times).

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text,
  dedupe_key text UNIQUE,
  in_app boolean NOT NULL DEFAULT true,
  emailed_at timestamptz,
  read_at timestamptz,
  sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES batches(id) ON DELETE SET NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL AND in_app;
CREATE INDEX idx_notifications_kind ON notifications(kind, created_at DESC);

-- Learner's own daily practice reminder.
CREATE TABLE reminder_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  local_time time NOT NULL DEFAULT '19:00',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  days smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  streak_alert boolean NOT NULL DEFAULT true,
  -- Reminders sent in a row without the learner practising since; drives back-off.
  consecutive_ignored integer NOT NULL DEFAULT 0,
  last_sent_on date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Per-batch switch for automatic nudges to not-started / inactive learners.
ALTER TABLE batches ADD COLUMN auto_reminders boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE batches DROP COLUMN auto_reminders;
DROP TABLE reminder_preferences;
DROP TABLE notifications;
