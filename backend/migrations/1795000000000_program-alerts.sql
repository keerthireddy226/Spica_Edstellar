-- Up Migration
-- Program monitoring alerts (ASSESSMENT_ENGINE.md section 9): at risk of
-- missing the target, inactive for 14 days, a missed mock. One row per
-- member and kind when raised; the same alert isn't raised again for 7 days.
CREATE TABLE program_alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('at_risk', 'inactive', 'missed_mock')),
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_program_alerts_lookup ON program_alerts(program_id, user_id, kind, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS program_alerts;
