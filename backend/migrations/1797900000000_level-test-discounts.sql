-- Up Migration
-- Level test discounts: half price to retake a level not passed, 25% off the
-- next level after passing one. The discount is kept on the order.
ALTER TABLE payment_orders ADD COLUMN discount_amount integer NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE payment_orders ADD COLUMN discount_reason text CHECK (discount_reason IS NULL OR discount_reason IN ('level_retake', 'next_level'));

-- Down Migration
ALTER TABLE payment_orders DROP COLUMN IF EXISTS discount_reason, DROP COLUMN IF EXISTS discount_amount;
