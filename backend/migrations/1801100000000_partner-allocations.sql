-- Up Migration
-- Channel Partners stage 2: licences a partner (or Spica staff for a partner)
-- gives to an organisation. Demo now; paid orders reuse this with kind 'paid'.
CREATE TABLE partner_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES channel_partners(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'demo' CHECK (kind IN ('demo', 'paid')),
  licences integer NOT NULL CHECK (licences > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_allocations_partner ON partner_allocations (partner_id, kind);
CREATE INDEX idx_partner_allocations_tenant ON partner_allocations (tenant_id);

-- Down Migration
DROP TABLE partner_allocations;
