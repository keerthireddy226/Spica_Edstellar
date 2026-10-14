-- Up Migration
-- 1. Single sign-on through the organization's identity provider (OIDC).
CREATE TABLE tenant_sso (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  client_id text NOT NULL,
  client_secret_sealed text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  -- Passwords stop working for this organization's people once on.
  enforce boolean NOT NULL DEFAULT false,
  -- Create a learner account on first sign-in for anyone on a verified domain.
  jit_provisioning boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Email domains an organization has proven it owns (DNS TXT record). Only a
-- verified domain routes sign-ins to that organization's identity provider.
CREATE TABLE sso_domains (
  domain text PRIMARY KEY CHECK (domain = lower(domain)),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  verification_token text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sso_domains_tenant ON sso_domains(tenant_id);

-- One sign-in attempt in flight: state, nonce and PKCE verifier.
CREATE TABLE sso_states (
  state text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- 2. SCIM provisioning: the identity provider creates, updates and
--    deactivates learners automatically.
ALTER TABLE tenants
  ADD COLUMN scim_token_hash text UNIQUE,
  ADD COLUMN scim_token_prefix text,
  ADD COLUMN scim_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN external_id text;
CREATE UNIQUE INDEX idx_users_tenant_external_id ON users(tenant_id, external_id) WHERE external_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_users_tenant_external_id;
ALTER TABLE users DROP COLUMN IF EXISTS external_id;
ALTER TABLE tenants DROP COLUMN IF EXISTS scim_enabled_at, DROP COLUMN IF EXISTS scim_token_prefix, DROP COLUMN IF EXISTS scim_token_hash;
DROP TABLE IF EXISTS sso_states;
DROP TABLE IF EXISTS sso_domains;
DROP TABLE IF EXISTS tenant_sso;
