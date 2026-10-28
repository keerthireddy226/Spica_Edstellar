-- Up Migration
-- Sign-up records that the person read and agreed to the Privacy Notice
-- (consent_version holds the notice's version date).
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records
  ADD CONSTRAINT consent_records_consent_type_check
    CHECK (consent_type = ANY (ARRAY['recording'::text, 'training_use'::text, 'voice_identity'::text, 'face_identity'::text, 'demographics'::text,
      'proctoring'::text, 'proctoring_biometric'::text, 'privacy_notice'::text]));

-- Down Migration
DELETE FROM consent_records WHERE consent_type = 'privacy_notice';
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records
  ADD CONSTRAINT consent_records_consent_type_check
    CHECK (consent_type = ANY (ARRAY['recording'::text, 'training_use'::text, 'voice_identity'::text, 'face_identity'::text, 'demographics'::text,
      'proctoring'::text, 'proctoring_biometric'::text]));
