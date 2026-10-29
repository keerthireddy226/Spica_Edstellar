-- Up Migration
-- Screenshots of the shared screen (on leaving the test, and every few
-- minutes) instead of a continuous screen recording.
ALTER TABLE proctoring_media DROP CONSTRAINT proctoring_media_kind_check;
ALTER TABLE proctoring_media
  ADD CONSTRAINT proctoring_media_kind_check
    CHECK (kind IN ('snapshot', 'room_scan', 'voice_baseline', 'id_document', 'id_selfie', 'video_segment', 'screen_segment', 'audio_clip', 'screen_shot'));

-- Down Migration
DELETE FROM proctoring_media WHERE kind = 'screen_shot';
ALTER TABLE proctoring_media DROP CONSTRAINT proctoring_media_kind_check;
ALTER TABLE proctoring_media
  ADD CONSTRAINT proctoring_media_kind_check
    CHECK (kind IN ('snapshot', 'room_scan', 'voice_baseline', 'id_document', 'id_selfie', 'video_segment', 'screen_segment', 'audio_clip'));
