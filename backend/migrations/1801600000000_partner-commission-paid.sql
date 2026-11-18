-- Up Migration
-- Channel Partners stage 9: commission payouts. Finance marks an order's
-- commission paid to the partner, with the payment reference.
ALTER TABLE partner_orders
  ADD COLUMN commission_paid_at timestamptz,
  ADD COLUMN commission_paid_reference text,
  ADD COLUMN commission_paid_by uuid REFERENCES users(id);

-- Down Migration
ALTER TABLE partner_orders DROP COLUMN commission_paid_at, DROP COLUMN commission_paid_reference, DROP COLUMN commission_paid_by;
