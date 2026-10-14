-- Up Migration
-- Each organization has exactly one Org Admin. Soft-deleted accounts do not count.
CREATE UNIQUE INDEX users_one_org_admin_per_tenant
  ON users (tenant_id)
  WHERE role = 'org_admin' AND deleted_at IS NULL;

-- Down Migration
DROP INDEX IF EXISTS users_one_org_admin_per_tenant;
