-- Up Migration
-- Upgrade credit (the unused part of a paid preparation, taken off Full access)
-- is used up once: an order records which preparations its credit came from,
-- each as a share of that preparation's value, so a later order only gets
-- what is left.
ALTER TABLE payment_orders ADD COLUMN credit_sources jsonb;

-- An invoice shows the credit and the discount as their own lines, so
-- quantity x unit price, less credit and discount, adds up to the subtotal.
ALTER TABLE invoices ADD COLUMN credit_amount integer NOT NULL DEFAULT 0 CHECK (credit_amount >= 0);
ALTER TABLE invoices ADD COLUMN discount_amount integer NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE invoices ADD COLUMN discount_reason text;
UPDATE invoices i SET credit_amount = o.credit_amount, discount_amount = o.discount_amount, discount_reason = o.discount_reason
FROM payment_orders o WHERE o.id = i.order_id AND (o.credit_amount > 0 OR o.discount_amount > 0);

-- Down Migration
ALTER TABLE invoices DROP COLUMN IF EXISTS discount_reason, DROP COLUMN IF EXISTS discount_amount, DROP COLUMN IF EXISTS credit_amount;
ALTER TABLE payment_orders DROP COLUMN IF EXISTS credit_sources;
