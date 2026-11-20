-- Up Migration
-- A referral fee can now come from any first paid purchase of the referred
-- organisation: licences, or credits (bought directly or through a partner
-- order) (owner, 20 Nov 2026). Credit purchases are recruitment_credit_events.
ALTER TABLE partner_earnings DROP CONSTRAINT partner_earnings_source_type_check;
ALTER TABLE partner_earnings ADD CONSTRAINT partner_earnings_source_type_check
  CHECK (source_type IN ('payment_order', 'license_purchase', 'credit_purchase'));

-- Down Migration
DELETE FROM partner_earnings WHERE source_type = 'credit_purchase';
ALTER TABLE partner_earnings DROP CONSTRAINT partner_earnings_source_type_check;
ALTER TABLE partner_earnings ADD CONSTRAINT partner_earnings_source_type_check
  CHECK (source_type IN ('payment_order', 'license_purchase'));
