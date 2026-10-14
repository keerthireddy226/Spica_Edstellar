-- Up Migration
-- Adds the 'manager' role (decided 2026-10-13, see the updated Login, Roles,
-- Permissions & Onboarding doc) — a contact inside a client org/university
-- scoped to one or more specific batches, never the whole organization.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('learner', 'org_admin', 'admin', 'super_admin', 'manager'));

ALTER TABLE users DROP CONSTRAINT tenant_required_by_role;
ALTER TABLE users ADD CONSTRAINT tenant_required_by_role CHECK (
    (role IN ('learner', 'org_admin', 'manager') AND tenant_id IS NOT NULL) OR (role IN ('admin', 'super_admin'))
);

-- Which Manager is assigned to which batch(es) — many-to-many so a batch
-- could in principle have more than one Manager, and a Manager could be
-- assigned to more than one batch.
CREATE TABLE batch_managers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id    UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (batch_id, user_id)
);
CREATE INDEX idx_batch_managers_batch_id ON batch_managers(batch_id);
CREATE INDEX idx_batch_managers_user_id ON batch_managers(user_id);

-- Down Migration
DROP TABLE IF EXISTS batch_managers;

ALTER TABLE users DROP CONSTRAINT IF EXISTS tenant_required_by_role;
ALTER TABLE users ADD CONSTRAINT tenant_required_by_role CHECK (
    (role IN ('learner', 'org_admin') AND tenant_id IS NOT NULL) OR (role IN ('admin', 'super_admin'))
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('learner', 'org_admin', 'admin', 'super_admin'));
