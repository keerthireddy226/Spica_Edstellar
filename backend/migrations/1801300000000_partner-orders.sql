-- Up Migration
-- Channel Partners stage 5: paid orders. An order is placed by a partner (or
-- by Spica staff, with or without a partner) for one or more organisations.
-- It has an Order ID, product lines, limits and two clocks: how long the order
-- is valid (clock 1) and how long each licence lasts once assigned (clock 2).
-- Every status change is recorded with who did it and when.
CREATE SEQUENCE IF NOT EXISTS partner_order_seq START 1;

CREATE TABLE partner_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  partner_id uuid REFERENCES channel_partners(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'proforma_sent', 'payment_received', 'confirmed', 'allocated', 'active', 'expired', 'cancelled')),
  -- India: INR with 18% GST. Abroad: USD, export of services, no Indian GST.
  in_india boolean NOT NULL DEFAULT true,
  currency text NOT NULL CHECK (currency IN ('INR', 'USD')),
  gstin text,
  max_organisations integer NOT NULL DEFAULT 10 CHECK (max_organisations BETWEEN 1 AND 500),
  -- Optional cap per organisation; null = total licences / organisations.
  per_org_cap integer CHECK (per_org_cap IS NULL OR per_org_cap > 0),
  valid_until date NOT NULL,
  licence_months integer NOT NULL DEFAULT 3 CHECK (licence_months IN (1, 3, 6)),
  subtotal integer NOT NULL DEFAULT 0,
  tax_rate numeric NOT NULL DEFAULT 0,
  tax_amount integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  commission_percent numeric NOT NULL DEFAULT 0,
  commission_amount integer NOT NULL DEFAULT 0,
  notes text,
  cancel_reason text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_orders_partner_idx ON partner_orders (partner_id, created_at DESC);
CREATE INDEX partner_orders_status_idx ON partner_orders (status);

-- One line per product. Amounts are in the order's currency, in paise / cents.
CREATE TABLE partner_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES partner_orders(id) ON DELETE CASCADE,
  -- full_access: licences (learner-months); product: a test product paid in
  -- credits; credits: plain recruitment / admissions credits.
  kind text NOT NULL CHECK (kind IN ('full_access', 'product', 'credits')),
  product_id text REFERENCES products(id),
  level text,
  quantity integer NOT NULL CHECK (quantity > 0),
  credits integer,
  unit_amount integer NOT NULL CHECK (unit_amount >= 0),
  amount integer NOT NULL CHECK (amount >= 0),
  price_overridden boolean NOT NULL DEFAULT false
);
CREATE INDEX partner_order_lines_order_idx ON partner_order_lines (order_id);

CREATE TABLE partner_order_organisations (
  order_id uuid NOT NULL REFERENCES partner_orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (order_id, tenant_id)
);

CREATE TABLE partner_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES partner_orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_order_events_order_idx ON partner_order_events (order_id, created_at);

-- Down Migration
DROP TABLE IF EXISTS partner_order_events;
DROP TABLE IF EXISTS partner_order_organisations;
DROP TABLE IF EXISTS partner_order_lines;
DROP TABLE IF EXISTS partner_orders;
DROP SEQUENCE IF EXISTS partner_order_seq;
