-- Up Migration
-- Phase 3: self-serve checkout. An order is created before payment, then
-- fulfilled exactly once when the provider confirms it — fulfilment adds a
-- license lot to the buyer's pool (and, for an individual, assigns it to
-- them) and issues an invoice.

CREATE TABLE payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  buyer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('org_licenses', 'individual_plan')),
  quantity integer NOT NULL CHECK (quantity > 0),
  currency text NOT NULL,
  unit_amount integer NOT NULL,       -- minor units (cents / paise)
  subtotal integer NOT NULL,
  tax_rate numeric(5, 2) NOT NULL DEFAULT 0,
  tax_amount integer NOT NULL DEFAULT 0,
  total integer NOT NULL,
  provider text NOT NULL CHECK (provider IN ('stripe', 'razorpay', 'test')),
  provider_order_id text,
  provider_payment_id text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'cancelled')),
  bill_to jsonb NOT NULL DEFAULT '{}'::jsonb,
  license_purchase_id uuid REFERENCES license_purchases(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX idx_payment_orders_tenant ON payment_orders(tenant_id, created_at DESC);
CREATE UNIQUE INDEX idx_payment_orders_provider_order ON payment_orders(provider, provider_order_id) WHERE provider_order_id IS NOT NULL;

CREATE SEQUENCE invoice_number_seq;

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  order_id uuid NOT NULL UNIQUE REFERENCES payment_orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  seller jsonb NOT NULL,
  bill_to jsonb NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL,
  currency text NOT NULL,
  unit_amount integer NOT NULL,
  subtotal integer NOT NULL,
  tax_label text,
  tax_rate numeric(5, 2) NOT NULL DEFAULT 0,
  tax_amount integer NOT NULL DEFAULT 0,
  total integer NOT NULL,
  provider text NOT NULL,
  provider_payment_id text
);
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id, issued_at DESC);

-- Down Migration
DROP TABLE invoices;
DROP SEQUENCE invoice_number_seq;
DROP TABLE payment_orders;
