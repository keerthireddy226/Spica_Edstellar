-- Up Migration
-- Per-person email preferences for console alerts (Managers today).
CREATE TABLE user_notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_digest boolean NOT NULL DEFAULT true,
  pool_alerts boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS user_notification_prefs;
