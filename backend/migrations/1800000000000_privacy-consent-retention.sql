-- Up Migration
-- Privacy and legal records (launch plan, product gaps 10.3, 10.4, 10.7, 10.9):
-- - which Terms and Privacy Policy version a user accepted, and when;
-- - a separate, optional consent for marketing emails;
-- - when an inactive account was warned before automatic deletion;
-- - a log of every privacy request (download, deletion, correction, objection).
ALTER TABLE users
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN terms_version text,
  ADD COLUMN marketing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN marketing_consent_at timestamptz,
  ADD COLUMN deletion_warned_at timestamptz;

CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('export', 'deletion', 'correction', 'objection', 'consent_withdrawal')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('received', 'in_progress', 'completed', 'refused')),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  details jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX privacy_requests_requested_at_idx ON privacy_requests (requested_at DESC);
CREATE INDEX privacy_requests_user_idx ON privacy_requests (user_id);

-- Consent records for the Terms and for marketing emails.
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN ('recording', 'training_use', 'voice_identity', 'face_identity', 'demographics', 'proctoring',
    'proctoring_biometric', 'privacy_notice', 'adult_confirmation', 'terms', 'marketing'));

-- Down Migration
DELETE FROM consent_records WHERE consent_type IN ('terms', 'marketing');
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN ('recording', 'training_use', 'voice_identity', 'face_identity', 'demographics', 'proctoring',
    'proctoring_biometric', 'privacy_notice', 'adult_confirmation'));
DROP TABLE privacy_requests;
ALTER TABLE users
  DROP COLUMN deletion_warned_at,
  DROP COLUMN marketing_consent_at,
  DROP COLUMN marketing_consent,
  DROP COLUMN terms_version,
  DROP COLUMN terms_accepted_at;
