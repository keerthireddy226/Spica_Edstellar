-- Up Migration
-- Switching preparation to a dearer test is paid: an order for the difference
-- that, once paid, moves this preparation to that test (owner decision 2026-10-22).
ALTER TABLE payment_orders ADD COLUMN switch_entitlement_id uuid REFERENCES entitlements(id) ON DELETE SET NULL;
ALTER TABLE payment_orders ADD COLUMN switch_to_test_type_id text REFERENCES test_types(id);

-- Down Migration
ALTER TABLE payment_orders DROP COLUMN IF EXISTS switch_to_test_type_id, DROP COLUMN IF EXISTS switch_entitlement_id;
