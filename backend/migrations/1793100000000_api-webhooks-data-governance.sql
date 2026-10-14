-- Up Migration
-- 1. API keys for an organization's own systems (LMS, HRIS). Only a hash is
--    stored; the full key is shown once when created.
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['read']::text[],
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);

-- 2. Webhooks: Spica calls the organization's URL when things happen.
CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  consecutive_failures integer NOT NULL DEFAULT 0,
  disabled_reason text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhooks_tenant ON webhooks(tenant_id);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  response_code integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX idx_webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at DESC);

-- 3. Organization data exports, built in the background.
CREATE TABLE data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'failed', 'expired')),
  file_path text,
  size_bytes bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX idx_data_exports_tenant ON data_exports(tenant_id, created_at DESC);

-- 4. Retention rules and the data processing agreement.
ALTER TABLE tenants
  -- Voice recordings and face images older than this are deleted (NULL = keep).
  ADD COLUMN retention_recordings_months integer CHECK (retention_recordings_months IS NULL OR retention_recordings_months BETWEEN 1 AND 120),
  -- Learners deactivated longer than this are erased (NULL = keep).
  ADD COLUMN retention_inactive_learner_months integer CHECK (retention_inactive_learner_months IS NULL OR retention_inactive_learner_months BETWEEN 1 AND 120),
  ADD COLUMN dpa_accepted_at timestamptz,
  ADD COLUMN dpa_accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN dpa_version text;

-- Erased accounts keep their learning statistics (and license accounting)
-- but nothing that identifies the person.
ALTER TABLE users ADD COLUMN erased_at timestamptz;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS erased_at;
ALTER TABLE tenants
  DROP COLUMN IF EXISTS dpa_version,
  DROP COLUMN IF EXISTS dpa_accepted_by,
  DROP COLUMN IF EXISTS dpa_accepted_at,
  DROP COLUMN IF EXISTS retention_inactive_learner_months,
  DROP COLUMN IF EXISTS retention_recordings_months;
DROP TABLE IF EXISTS data_exports;
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhooks;
DROP TABLE IF EXISTS api_keys;
