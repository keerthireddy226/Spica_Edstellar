-- Up Migration
-- Each order line keeps Spica's list price and the Reseller discount applied,
-- so the order, proforma and invoice can show "list price, discount, price".
ALTER TABLE partner_order_lines
  ADD COLUMN list_unit_amount integer CHECK (list_unit_amount IS NULL OR list_unit_amount >= 0),
  ADD COLUMN discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 90);

-- Existing lines: a Reseller's lines (not price-overridden) were priced at list
-- less its current discount; everything else was at list.
UPDATE partner_order_lines l
SET discount_percent = cp.discount_percent,
    list_unit_amount = round(l.unit_amount * 100 / (100 - cp.discount_percent))::int
FROM partner_orders o JOIN channel_partners cp ON cp.id = o.partner_id
WHERE o.id = l.order_id AND cp.partner_type = 'reseller' AND cp.discount_percent > 0 AND NOT l.price_overridden;
UPDATE partner_order_lines SET list_unit_amount = unit_amount WHERE list_unit_amount IS NULL AND NOT price_overridden;

-- Down Migration
ALTER TABLE partner_order_lines DROP COLUMN IF EXISTS discount_percent, DROP COLUMN IF EXISTS list_unit_amount;
