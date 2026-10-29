-- Up Migration
-- With the Privacy Notice, people confirm they are 18 or older.
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records
  ADD CONSTRAINT consent_records_consent_type_check
    CHECK (consent_type = ANY (ARRAY['recording'::text, 'training_use'::text, 'voice_identity'::text, 'face_identity'::text, 'demographics'::text,
      'proctoring'::text, 'proctoring_biometric'::text, 'privacy_notice'::text, 'adult_confirmation'::text]));

-- Down Migration
DELETE FROM consent_records WHERE consent_type = 'adult_confirmation';
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records
  ADD CONSTRAINT consent_records_consent_type_check
    CHECK (consent_type = ANY (ARRAY['recording'::text, 'training_use'::text, 'voice_identity'::text, 'face_identity'::text, 'demographics'::text,
      'proctoring'::text, 'proctoring_biometric'::text, 'privacy_notice'::text]));
