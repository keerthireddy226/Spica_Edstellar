-- Up Migration
-- 1. Deleting a learner used to cascade-delete their license assignments,
--    which quietly put months they had already used back into the pool.
--    The assignments now stay (with no user) so they keep counting as used.
ALTER TABLE license_assignments DROP CONSTRAINT license_assignments_user_id_fkey;
ALTER TABLE license_assignments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE license_assignments
  ADD CONSTRAINT license_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 2. Audit log: who did what inside an organization. License changes and
--    plan changes keep their own tables; the audit view merges all three.
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Kept as text so the entry still reads correctly after the actor is deleted.
  actor_label text,
  actor_role text,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  target_label text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS audit_log;
DELETE FROM license_assignments WHERE user_id IS NULL;
ALTER TABLE license_assignments DROP CONSTRAINT license_assignments_user_id_fkey;
ALTER TABLE license_assignments ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE license_assignments
  ADD CONSTRAINT license_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
