-- Up Migration
-- 1. Batch lifecycle: active → completed (by hand, or automatically once its
--    end date passes) → archived (hidden, read-only). Completing releases the
--    batch's unused fixed licenses.
ALTER TABLE batches
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN cloned_from uuid REFERENCES batches(id) ON DELETE SET NULL;
CREATE INDEX idx_batches_tenant_status ON batches(tenant_id, status);

-- 2. Organization settings.
ALTER TABLE tenants
  ADD COLUMN logo_path text,
  ADD COLUMN brand_color text CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN default_language text,
  ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN reminder_default_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN reminder_default_time time NOT NULL DEFAULT '19:00',
  ADD COLUMN face_check_required boolean NOT NULL DEFAULT true,
  -- NULL = every practice-test product is available.
  ADD COLUMN allowed_test_products text[];

-- Down Migration
ALTER TABLE tenants
  DROP COLUMN IF EXISTS allowed_test_products,
  DROP COLUMN IF EXISTS face_check_required,
  DROP COLUMN IF EXISTS reminder_default_time,
  DROP COLUMN IF EXISTS reminder_default_enabled,
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS default_language,
  DROP COLUMN IF EXISTS brand_color,
  DROP COLUMN IF EXISTS logo_path;
DROP INDEX IF EXISTS idx_batches_tenant_status;
ALTER TABLE batches DROP COLUMN IF EXISTS cloned_from, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS status;
