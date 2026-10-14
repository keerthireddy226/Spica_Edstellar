-- Up Migration
-- 1. Scheduled progress reports: each Org Admin or Manager chooses their own.
CREATE TABLE report_subscriptions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  frequency text NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'monthly', 'off')),
  -- The period last sent, e.g. '2026-W42' or '2026-10', so each goes out once.
  last_period text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Completion certificates. Names are copied in so a certificate still
--    reads correctly if the learner, batch or organization later changes.
CREATE TABLE certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES batches(id) ON DELETE SET NULL,
  learner_name text NOT NULL,
  participant_id text,
  organization_name text,
  batch_name text,
  cefr_level text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  UNIQUE (user_id, batch_id)
);
CREATE INDEX idx_certificates_tenant ON certificates(tenant_id, issued_at DESC);

-- 3. Two-factor sign-in (TOTP authenticator apps).
ALTER TABLE users
  ADD COLUMN mfa_secret text,
  ADD COLUMN mfa_enabled_at timestamptz,
  ADD COLUMN mfa_recovery_hashes text[];

-- Password checked, second factor still owed: a short-lived ticket.
CREATE TABLE mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Organization security policies.
ALTER TABLE tenants
  ADD COLUMN mfa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN ip_allowlist text[],
  ADD COLUMN session_idle_minutes integer CHECK (session_idle_minutes IS NULL OR session_idle_minutes BETWEEN 5 AND 10080),
  ADD COLUMN password_min_length integer NOT NULL DEFAULT 8 CHECK (password_min_length BETWEEN 8 AND 64),
  ADD COLUMN invite_expiry_hours integer NOT NULL DEFAULT 24 CHECK (invite_expiry_hours BETWEEN 1 AND 720);

ALTER TABLE auth_sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();

-- Down Migration
ALTER TABLE auth_sessions DROP COLUMN IF EXISTS last_seen_at;
ALTER TABLE tenants
  DROP COLUMN IF EXISTS invite_expiry_hours,
  DROP COLUMN IF EXISTS password_min_length,
  DROP COLUMN IF EXISTS session_idle_minutes,
  DROP COLUMN IF EXISTS ip_allowlist,
  DROP COLUMN IF EXISTS mfa_required;
DROP TABLE IF EXISTS mfa_challenges;
ALTER TABLE users DROP COLUMN IF EXISTS mfa_recovery_hashes, DROP COLUMN IF EXISTS mfa_enabled_at, DROP COLUMN IF EXISTS mfa_secret;
DROP TABLE IF EXISTS certificates;
DROP TABLE IF EXISTS report_subscriptions;
