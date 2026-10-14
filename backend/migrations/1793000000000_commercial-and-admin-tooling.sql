-- Up Migration
-- 1. Contracts and account management.
ALTER TABLE tenants
  ADD COLUMN contract_start date,
  ADD COLUMN contract_end date,
  ADD COLUMN contract_value_cents bigint CHECK (contract_value_cents IS NULL OR contract_value_cents >= 0),
  ADD COLUMN contract_currency text,
  ADD COLUMN contract_notes text,
  ADD COLUMN account_manager_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- 2. Pay by invoice: an order the organization asks for with a PO number,
--    sent a proforma (quote), and marked paid by Edstellar when the money
--    arrives. Same fulfilment as online checkout from then on.
ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_provider_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_provider_check CHECK (provider IN ('stripe', 'razorpay', 'test', 'invoice'));
ALTER TABLE payment_orders
  ADD COLUMN po_number text,
  ADD COLUMN quote_number text UNIQUE,
  ADD COLUMN due_date date,
  ADD COLUMN marked_paid_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN payment_reference text;
CREATE SEQUENCE quote_number_seq;

-- 3. Credit notes: money back against an invoice, optionally taking unused
--    licenses back out of the pool.
CREATE SEQUENCE credit_note_number_seq;
CREATE TABLE credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES users(id) ON DELETE SET NULL,
  licenses_removed integer NOT NULL DEFAULT 0 CHECK (licenses_removed >= 0),
  currency text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  reason text NOT NULL
);
CREATE INDEX idx_credit_notes_invoice ON credit_notes(invoice_id);

-- Licenses taken back by a credit note leave the lot (its quantity drops),
-- recorded as a 'refund' event.
ALTER TABLE license_events DROP CONSTRAINT license_events_kind_check;
ALTER TABLE license_events ADD CONSTRAINT license_events_kind_check CHECK (kind IN (
  'purchase', 'credit', 'comp', 'assign', 'extend', 'reclaim', 'budget', 'request', 'manager_allotment', 'refund'));

-- 4. Read-only "view as" sessions for Edstellar staff, always attributed.
ALTER TABLE auth_sessions
  ADD COLUMN impersonator_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN read_only boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE auth_sessions DROP COLUMN IF EXISTS read_only, DROP COLUMN IF EXISTS impersonator_id;
DELETE FROM license_events WHERE kind = 'refund';
ALTER TABLE license_events DROP CONSTRAINT license_events_kind_check;
ALTER TABLE license_events ADD CONSTRAINT license_events_kind_check CHECK (kind IN (
  'purchase', 'credit', 'comp', 'assign', 'extend', 'reclaim', 'budget', 'request', 'manager_allotment'));
DROP TABLE IF EXISTS credit_notes;
DROP SEQUENCE IF EXISTS credit_note_number_seq;
DROP SEQUENCE IF EXISTS quote_number_seq;
ALTER TABLE payment_orders
  DROP COLUMN IF EXISTS payment_reference,
  DROP COLUMN IF EXISTS marked_paid_by,
  DROP COLUMN IF EXISTS due_date,
  DROP COLUMN IF EXISTS quote_number,
  DROP COLUMN IF EXISTS po_number;
DELETE FROM payment_orders WHERE provider = 'invoice';
ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_provider_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_provider_check CHECK (provider IN ('stripe', 'razorpay', 'test'));
ALTER TABLE tenants
  DROP COLUMN IF EXISTS account_manager_id,
  DROP COLUMN IF EXISTS contract_notes,
  DROP COLUMN IF EXISTS contract_currency,
  DROP COLUMN IF EXISTS contract_value_cents,
  DROP COLUMN IF EXISTS contract_end,
  DROP COLUMN IF EXISTS contract_start;
