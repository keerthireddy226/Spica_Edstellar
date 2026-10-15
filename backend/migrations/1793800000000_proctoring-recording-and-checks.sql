-- Up Migration
-- Recorded video and screen segments, background-speech clips, head
-- direction on snapshots, what was read from an ID document, and the
-- post-test typing comparison.

ALTER TABLE proctoring_media DROP CONSTRAINT proctoring_media_kind_check;
ALTER TABLE proctoring_media
  ADD CONSTRAINT proctoring_media_kind_check
    CHECK (kind IN ('snapshot', 'room_scan', 'voice_baseline', 'id_document', 'id_selfie', 'video_segment', 'screen_segment', 'audio_clip'));
ALTER TABLE proctoring_media
  -- Order of a recording segment within the session.
  ADD COLUMN segment_seq integer,
  ADD COLUMN duration_ms integer,
  ADD COLUMN head_yaw numeric,
  ADD COLUMN head_pitch numeric,
  ADD COLUMN head_direction text;
CREATE INDEX idx_proctoring_media_segments ON proctoring_media (session_id, kind, segment_seq) WHERE segment_seq IS NOT NULL;

-- The machine-readable zone of a passport or ID card, read on upload.
ALTER TABLE identity_verifications
  ADD COLUMN mrz jsonb,
  ADD COLUMN liveness_score numeric;

-- Results of checks that run after the test, by name (e.g. typing).
ALTER TABLE session_integrity ADD COLUMN checks jsonb NOT NULL DEFAULT '{}';

-- Down Migration
ALTER TABLE session_integrity DROP COLUMN checks;
ALTER TABLE identity_verifications DROP COLUMN liveness_score, DROP COLUMN mrz;
DROP INDEX idx_proctoring_media_segments;
ALTER TABLE proctoring_media DROP COLUMN head_direction, DROP COLUMN head_pitch, DROP COLUMN head_yaw, DROP COLUMN duration_ms, DROP COLUMN segment_seq;
DELETE FROM proctoring_media WHERE kind IN ('video_segment', 'screen_segment', 'audio_clip');
ALTER TABLE proctoring_media DROP CONSTRAINT proctoring_media_kind_check;
ALTER TABLE proctoring_media
  ADD CONSTRAINT proctoring_media_kind_check
    CHECK (kind IN ('snapshot', 'room_scan', 'voice_baseline', 'id_document', 'id_selfie'));
