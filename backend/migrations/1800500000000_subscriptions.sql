-- Up Migration
-- Full access that renews every month until cancelled (launch plan, product
-- gaps 10.18 and 10.19; Stripe tasks 6.4 to 6.7). Card payments only (Stripe);
-- each paid month becomes an ordinary order and invoice.
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('stripe', 'test')),
  provider_subscription_id text UNIQUE,
  provider_customer_id text,
  currency text NOT NULL,
  -- One month's price before tax, and the tax, in minor units.
  unit_amount integer NOT NULL,
  tax_rate numeric(5, 2) NOT NULL DEFAULT 0,
  tax_amount integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'trialing', 'active', 'past_due', 'canceled')),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  current_period_end timestamptz,
  -- After a failed renewal: access continues until this time.
  grace_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  canceled_at timestamptz
);
-- One live subscription per person.
CREATE UNIQUE INDEX uq_subscriptions_live_user ON subscriptions (user_id) WHERE status IN ('trialing', 'active', 'past_due');
CREATE INDEX idx_subscriptions_user ON subscriptions (user_id, created_at DESC);

ALTER TABLE payment_orders ADD COLUMN subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL;
-- A renewal's order carries the provider's invoice id as provider_order_id;
-- the existing unique index on (provider, provider_order_id) pays it once.

-- Down Migration
ALTER TABLE payment_orders DROP COLUMN subscription_id;
DROP TABLE subscriptions;
