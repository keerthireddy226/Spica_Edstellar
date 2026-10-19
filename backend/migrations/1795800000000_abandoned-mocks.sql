-- Up Migration
-- Mocks that ran out of time while the learner was away, with nothing
-- answered, were finished with every question skipped and counted towards the
-- month's mocks. They're now set aside (abandoned): not counted, not listed.
UPDATE sessions s SET composition = s.composition || '{"abandoned": true}'::jsonb
WHERE s.session_type = 'mocktest' AND s.delivery_mode = 'mock' AND s.completed_at IS NOT NULL
  AND s.composition ? 'deadlineAt' AND s.completed_at > (s.composition->>'deadlineAt')::timestamptz
  AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL));

-- Down Migration
UPDATE sessions SET composition = composition - 'abandoned' WHERE composition ? 'abandoned';
