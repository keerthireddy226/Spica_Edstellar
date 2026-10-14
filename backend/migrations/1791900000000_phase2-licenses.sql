-- Up Migration
-- Phase 2: license pools. 1 license = 1 learner's access for 1 month from
-- the moment it's assigned. Organizations hold a pool (bought or credited in
-- lots); assigning moves licenses out of the pool onto a learner, stacking
-- back-to-back months. Unassigned licenses expire 12 months after purchase.

CREATE TABLE license_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL DEFAULT 10000 CHECK (unit_price_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  -- purchase: paid (sales-led now, checkout in Phase 3); credit: manual top-up
  -- by Edstellar; comp: complimentary, not billed.
  source text NOT NULL CHECK (source IN ('purchase', 'credit', 'comp')),
  reference text,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  pool_expires_at timestamptz NOT NULL
);
CREATE INDEX idx_license_purchases_tenant ON license_purchases(tenant_id);

-- One row per assigned license-month.
CREATE TABLE license_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL REFERENCES license_purchases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Batch the learner was in when assigned — used for per-batch budgets.
  batch_id uuid REFERENCES batches(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  -- Set when a queued (not yet started) month is returned to the pool.
  reclaimed_at timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_license_assignments_user ON license_assignments(user_id) WHERE reclaimed_at IS NULL;
CREATE INDEX idx_license_assignments_purchase ON license_assignments(purchase_id) WHERE reclaimed_at IS NULL;
CREATE INDEX idx_license_assignments_tenant ON license_assignments(tenant_id);

-- Append-only audit trail. Balances are always computed from purchases and
-- assignments; this is the human-readable history of who did what.
CREATE TABLE license_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('purchase', 'credit', 'comp', 'assign', 'extend', 'reclaim', 'budget')),
  quantity integer NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  user_email text,
  batch_id uuid REFERENCES batches(id) ON DELETE SET NULL,
  batch_name text,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_license_events_tenant ON license_events(tenant_id, created_at DESC);

-- Max licenses Managers may assign within a batch. NULL = Managers can't
-- assign in this batch (only the Org Admin can).
ALTER TABLE batches ADD COLUMN license_budget integer CHECK (license_budget IS NULL OR license_budget >= 0);

-- Down Migration
ALTER TABLE batches DROP COLUMN license_budget;
DROP TABLE license_events;
DROP TABLE license_assignments;
DROP TABLE license_purchases;
