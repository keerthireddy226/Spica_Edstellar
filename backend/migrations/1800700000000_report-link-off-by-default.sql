-- Up Migration
-- Consent register C13: the full score report behind a certificate is shared
-- only when the learner chooses (privacy by default). Certificates issued
-- before this change were shared by default, without a choice: they are
-- switched off too, and the learner can switch them on.
ALTER TABLE certificates ALTER COLUMN report_public SET DEFAULT false;
UPDATE certificates SET report_public = false WHERE report_public;

-- The learner's choice is kept as a consent record.
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN ('recording', 'training_use', 'voice_identity', 'face_identity', 'demographics', 'proctoring',
    'proctoring_biometric', 'privacy_notice', 'adult_confirmation', 'terms', 'marketing', 'report_sharing'));

-- Down Migration
DELETE FROM consent_records WHERE consent_type = 'report_sharing';
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN ('recording', 'training_use', 'voice_identity', 'face_identity', 'demographics', 'proctoring',
    'proctoring_biometric', 'privacy_notice', 'adult_confirmation', 'terms', 'marketing'));
ALTER TABLE certificates ALTER COLUMN report_public SET DEFAULT true;
