-- Up Migration
-- Channel Partners stage 6: Finance on partner orders. The proforma invoice
-- (its own PF- series), the payment (Stripe link or bank transfer) and the
-- final tax invoice, numbered in the same INV- series as every other invoice.
CREATE SEQUENCE IF NOT EXISTS proforma_number_seq START 1;

ALTER TABLE partner_orders
  ADD COLUMN bill_to jsonb,
  ADD COLUMN proforma_number text UNIQUE,
  ADD COLUMN proforma_sent_at timestamptz,
  ADD COLUMN payment_link_url text,
  ADD COLUMN stripe_session_id text,
  ADD COLUMN payment_method text CHECK (payment_method IS NULL OR payment_method IN ('stripe', 'bank', 'other')),
  ADD COLUMN payment_reference text,
  ADD COLUMN payment_amount integer,
  ADD COLUMN payment_received_on date,
  ADD COLUMN invoice_number text UNIQUE,
  ADD COLUMN invoice_issued_at timestamptz;

-- Down Migration
ALTER TABLE partner_orders
  DROP COLUMN bill_to, DROP COLUMN proforma_number, DROP COLUMN proforma_sent_at, DROP COLUMN payment_link_url,
  DROP COLUMN stripe_session_id, DROP COLUMN payment_method, DROP COLUMN payment_reference, DROP COLUMN payment_amount,
  DROP COLUMN payment_received_on, DROP COLUMN invoice_number, DROP COLUMN invoice_issued_at;
DROP SEQUENCE IF EXISTS proforma_number_seq;
