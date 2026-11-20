-- Up Migration
-- Affiliate tracking (owner, 20 Nov 2026).
-- 1. Clicks on an Affiliate's link: one row per visitor per day. The visitor is
--    a one-way hash (no IP address or browser details are stored).
CREATE TABLE partner_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES channel_partners(id) ON DELETE CASCADE,
  visitor text NOT NULL,
  src text,
  clicked_on date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, visitor, clicked_on)
);
CREATE INDEX idx_partner_link_clicks_partner ON partner_link_clicks (partner_id, clicked_on);

-- 2. How a person was credited to an Affiliate: the link, the code typed at
--    sign-up, or the code typed later on the Plans page.
ALTER TABLE users ADD COLUMN referred_via text CHECK (referred_via IS NULL OR referred_via IN ('link', 'code', 'plans'));

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS referred_via;
DROP TABLE IF EXISTS partner_link_clicks;
