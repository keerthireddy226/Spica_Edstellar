-- Up Migration
-- Channel Partners (18 Nov 2026), stage 1: Spica staff register partners, give
-- each a unique code, a commission rate (0 until decided) and a free demo
-- allocation (250 licences by default) with its own window, and can switch on
-- one demo licence for the partner's own use. Paid orders come in a later stage.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['learner'::text, 'org_admin'::text, 'admin'::text, 'super_admin'::text, 'manager'::text, 'recruiter'::text, 'candidate'::text, 'channel_partner'::text]));
ALTER TABLE users DROP CONSTRAINT tenant_required_by_role;
ALTER TABLE users ADD CONSTRAINT tenant_required_by_role
  CHECK ((role = ANY (ARRAY['learner'::text, 'org_admin'::text, 'manager'::text, 'recruiter'::text, 'candidate'::text]) AND tenant_id IS NOT NULL)
    OR role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'channel_partner'::text]));

CREATE TABLE channel_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The partner's sign-in (role channel_partner).
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  full_name text NOT NULL,
  email text NOT NULL,
  code text NOT NULL UNIQUE,
  -- Percent of each paid order's value; 0 until the business decides.
  commission_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_percent >= 0 AND commission_percent <= 100),
  demo_licences integer NOT NULL DEFAULT 250 CHECK (demo_licences >= 0),
  -- The demo window starts when Spica makes the licences available; null until then.
  demo_starts_at timestamptz,
  demo_ends_at timestamptz,
  -- Set when Spica ends the demo window early.
  demo_ended_at timestamptz,
  -- One demo licence for the partner's own demonstrations.
  own_licence_enabled boolean NOT NULL DEFAULT false,
  notes text,
  deactivated_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (demo_ends_at IS NULL OR demo_starts_at IS NULL OR demo_ends_at > demo_starts_at)
);
CREATE INDEX idx_channel_partners_email ON channel_partners (lower(email));

-- Organisations a partner brings (stage 2 fills this in).
ALTER TABLE tenants ADD COLUMN channel_partner_id uuid REFERENCES channel_partners(id) ON DELETE SET NULL;
CREATE INDEX idx_tenants_channel_partner ON tenants (channel_partner_id) WHERE channel_partner_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_tenants_channel_partner;
ALTER TABLE tenants DROP COLUMN channel_partner_id;
DROP TABLE channel_partners;
DELETE FROM users WHERE role = 'channel_partner';
ALTER TABLE users DROP CONSTRAINT tenant_required_by_role;
ALTER TABLE users ADD CONSTRAINT tenant_required_by_role
  CHECK ((role = ANY (ARRAY['learner'::text, 'org_admin'::text, 'manager'::text, 'recruiter'::text, 'candidate'::text]) AND tenant_id IS NOT NULL)
    OR role = ANY (ARRAY['admin'::text, 'super_admin'::text]));
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['learner'::text, 'org_admin'::text, 'admin'::text, 'super_admin'::text, 'manager'::text, 'recruiter'::text, 'candidate'::text]));
