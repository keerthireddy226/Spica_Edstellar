-- Up Migration
-- A credit note can now also refund the payment through Stripe or Razorpay
-- and remove what the order gave (launch plan, product gap 10.20).
ALTER TABLE credit_notes
  ADD COLUMN provider_refund_id text,
  ADD COLUMN refunded_to_card boolean NOT NULL DEFAULT false,
  ADD COLUMN access_removed boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE credit_notes DROP COLUMN access_removed, DROP COLUMN refunded_to_card, DROP COLUMN provider_refund_id;
