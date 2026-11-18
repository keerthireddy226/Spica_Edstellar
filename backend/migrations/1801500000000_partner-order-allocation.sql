-- Up Migration
-- Channel Partners stage 7: a confirmed order's licences and credits are
-- allocated to its organisations. Licences go into the organisation's normal
-- pool as learner-months (licences x the order's licence length), usable until
-- the order's end date. A 3-day setup grace runs from allocation: a learner
-- assigned during it gets access at once, but their licence clock starts when
-- the grace ends. Credits go into the organisation's credit ledger.
ALTER TABLE license_purchases
  ADD COLUMN partner_order_id uuid REFERENCES partner_orders(id),
  ADD COLUMN starts_not_before timestamptz;

CREATE TABLE partner_order_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES partner_orders(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  licences integer NOT NULL DEFAULT 0 CHECK (licences >= 0),
  credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
  purchase_id uuid REFERENCES license_purchases(id),
  grace_ends_at timestamptz NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (licences > 0 OR credits > 0)
);
CREATE INDEX partner_order_allocations_order_idx ON partner_order_allocations (order_id);
CREATE INDEX partner_order_allocations_tenant_idx ON partner_order_allocations (tenant_id);

-- Down Migration
DROP TABLE IF EXISTS partner_order_allocations;
ALTER TABLE license_purchases DROP COLUMN IF EXISTS partner_order_id, DROP COLUMN IF EXISTS starts_not_before;
