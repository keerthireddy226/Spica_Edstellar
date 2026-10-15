-- Up Migration
-- How a reviewer wants integrity alerts emailed: each one as it happens, or
-- one summary a day. The notification bell shows every alert either way.
ALTER TABLE user_notification_prefs
  ADD COLUMN integrity_alerts text NOT NULL DEFAULT 'instant' CHECK (integrity_alerts IN ('instant', 'daily'));

-- Down Migration
ALTER TABLE user_notification_prefs DROP COLUMN IF EXISTS integrity_alerts;
