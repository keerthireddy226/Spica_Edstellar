-- Up Migration
-- Test proctoring: an organization-level policy, the per-session integrity
-- record that reviewers work from, the events and media behind it, and
-- identity-document checks. Every signal here feeds human review; nothing
-- in these tables blocks a learner on its own.

-- null = the default policy for the organization's mode and region.
ALTER TABLE tenants ADD COLUMN proctoring jsonb;

ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records
  ADD CONSTRAINT consent_records_consent_type_check
    CHECK (consent_type = ANY (ARRAY['recording'::text, 'training_use'::text, 'voice_identity'::text, 'face_identity'::text, 'demographics'::text,
      'proctoring'::text, 'proctoring_biometric'::text]));

CREATE TABLE session_integrity (
    session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
    session_type text NOT NULL,
    -- The policy as it was when the session started, so later edits don't
    -- change how an old session is judged.
    policy jsonb NOT NULL,
    consent_record_id uuid REFERENCES consent_records(id) ON DELETE SET NULL,
    -- The learner chose the non-biometric route: a reviewer checks identity by hand.
    biometric_opt_out boolean NOT NULL DEFAULT false,
    secure_browser boolean,
    risk_score integer NOT NULL DEFAULT 0,
    risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
    status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'clear', 'flagged', 'cleared', 'violation')),
    reasons jsonb NOT NULL DEFAULT '[]',
    live_message text,
    live_message_at timestamptz,
    live_message_seen_at timestamptz,
    terminated_at timestamptz,
    terminated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    terminate_reason text,
    last_seen_at timestamptz,
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    review_note text,
    analyzed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_session_integrity_tenant ON session_integrity (tenant_id, status);
CREATE INDEX idx_session_integrity_user ON session_integrity (user_id);
CREATE INDEX idx_session_integrity_live ON session_integrity (last_seen_at) WHERE status = 'in_progress';

CREATE TABLE proctoring_events (
    id bigserial PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL,
    severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'high')),
    detail jsonb,
    client_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proctoring_events_session ON proctoring_events (session_id, created_at);

-- Files live outside the public uploads folder and are served only to the
-- learner's reviewers. uri is relative to the private storage root.
CREATE TABLE proctoring_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('snapshot', 'room_scan', 'voice_baseline', 'id_document', 'id_selfie')),
    uri text,
    face_count integer,
    face_decision text,
    face_similarity numeric,
    objects jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proctoring_media_session ON proctoring_media (session_id, created_at);
CREATE INDEX idx_proctoring_media_user ON proctoring_media (user_id);

CREATE TABLE identity_verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    document_type text NOT NULL CHECK (document_type IN ('passport', 'national_id', 'driving_licence', 'other')),
    document_media_id uuid REFERENCES proctoring_media(id) ON DELETE SET NULL,
    selfie_media_id uuid REFERENCES proctoring_media(id) ON DELETE SET NULL,
    -- Face on the document against the live selfie. A hint for the reviewer only.
    face_similarity numeric,
    auto_decision text,
    consent_record_id uuid REFERENCES consent_records(id) ON DELETE SET NULL,
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    review_note text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_identity_verifications_user ON identity_verifications (user_id, created_at DESC);
CREATE INDEX idx_identity_verifications_pending ON identity_verifications (tenant_id) WHERE status = 'pending';

-- Voice consistency now runs after the test over many answers; too little
-- speech is its own outcome rather than a mismatch.
ALTER TABLE voice_check_results DROP CONSTRAINT voice_check_results_decision_check;
ALTER TABLE voice_check_results
  ADD CONSTRAINT voice_check_results_decision_check CHECK (decision IN ('match', 'uncertain', 'mismatch', 'error', 'insufficient_audio'));
ALTER TABLE voice_check_results ADD COLUMN method text NOT NULL DEFAULT 'enrollment', ADD COLUMN detail jsonb;

-- Down Migration
ALTER TABLE voice_check_results DROP COLUMN detail, DROP COLUMN method;
DELETE FROM voice_check_results WHERE decision = 'insufficient_audio';
ALTER TABLE voice_check_results DROP CONSTRAINT voice_check_results_decision_check;
ALTER TABLE voice_check_results
  ADD CONSTRAINT voice_check_results_decision_check CHECK (decision IN ('match', 'uncertain', 'mismatch', 'error'));
DROP TABLE identity_verifications;
DROP TABLE proctoring_media;
DROP TABLE proctoring_events;
DROP TABLE session_integrity;
DELETE FROM consent_records WHERE consent_type IN ('proctoring', 'proctoring_biometric');
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records
  ADD CONSTRAINT consent_records_consent_type_check
    CHECK (consent_type = ANY (ARRAY['recording'::text, 'training_use'::text, 'voice_identity'::text, 'face_identity'::text, 'demographics'::text]));
ALTER TABLE tenants DROP COLUMN proctoring;
