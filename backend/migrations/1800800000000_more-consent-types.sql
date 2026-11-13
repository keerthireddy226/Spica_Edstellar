-- Up Migration
-- Consent register N01–N06: the test rules declaration, the candidates'
-- notice of automatic scoring, and the checkout agreements (refund policy,
-- monthly renewal, the EU "start now" waiver) are kept as consent records.
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN ('recording', 'training_use', 'voice_identity', 'face_identity', 'demographics', 'proctoring',
    'proctoring_biometric', 'privacy_notice', 'adult_confirmation', 'terms', 'marketing', 'report_sharing',
    'test_rules', 'automated_scoring_notice', 'refund_policy', 'subscription_renewal', 'withdrawal_waiver'));

-- Down Migration
DELETE FROM consent_records WHERE consent_type IN ('test_rules', 'automated_scoring_notice', 'refund_policy', 'subscription_renewal', 'withdrawal_waiver');
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN ('recording', 'training_use', 'voice_identity', 'face_identity', 'demographics', 'proctoring',
    'proctoring_biometric', 'privacy_notice', 'adult_confirmation', 'terms', 'marketing', 'report_sharing'));
