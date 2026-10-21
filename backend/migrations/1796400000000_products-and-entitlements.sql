-- Up Migration
-- 1. What Spica sells. Spica staff edit names, prices and what's included
--    here (no code change). Prices are placeholders until set.
--    kind: full        everything (today's licences and the Plus plan)
--          prep        one test: its practice tests, mocks and Practice Modules
--                      question types, plus one certified attempt
--          assessment  one certified attempt at one test
--          level       one certified attempt at a level test (level chosen when buying)
CREATE TABLE products (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('full', 'prep', 'assessment', 'level')),
  test_type_id text REFERENCES test_types(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- Individuals pay in INR (paise); organisations in credits (assessments)
  -- or licence-months (full and prep).
  price_paise integer NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  credits integer CHECK (credits IS NULL OR credits >= 0),
  duration_days integer NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  -- Certified attempts included (prep 1, assessment 1, level 1, full none).
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind IN ('prep', 'assessment')) = (test_type_id IS NOT NULL))
);

INSERT INTO products (id, kind, test_type_id, name, description, price_paise, credits, duration_days, attempts, sort_order) VALUES
  ('full_access', 'full', NULL, 'Full access', 'Every test, practice test, mock exam and Practice Module.', 0, NULL, 30, 0, 10),
  ('prep_fourSkills', 'prep', 'fourSkills', 'English 4-Skills Essentials Test: preparation + assessment', 'One month of practice for this test, then one certified attempt with a certificate.', 0, NULL, 30, 1, 20),
  ('prep_speakingListening', 'prep', 'speakingListening', 'English Speaking and Listening Test: preparation + assessment', 'One month of practice for this test, then one certified attempt with a certificate.', 0, NULL, 30, 1, 21),
  ('prep_writing', 'prep', 'writing', 'English Writing Test: preparation + assessment', 'One month of practice for this test, then one certified attempt with a certificate.', 0, NULL, 30, 1, 22),
  ('prep_professional', 'prep', 'professional', 'Professional English Test: preparation + assessment', 'One month of practice for this test, then one certified attempt with a certificate.', 0, NULL, 30, 1, 23),
  ('assess_fourSkills', 'assessment', 'fourSkills', 'English 4-Skills Essentials Test: assessment', 'One certified attempt, a score report and a certificate.', 0, 1, 30, 1, 30),
  ('assess_speakingListening', 'assessment', 'speakingListening', 'English Speaking and Listening Test: assessment', 'One certified attempt, a score report and a certificate.', 0, 1, 30, 1, 31),
  ('assess_writing', 'assessment', 'writing', 'English Writing Test: assessment', 'One certified attempt, a score report and a certificate.', 0, 1, 30, 1, 32),
  ('assess_professional', 'assessment', 'professional', 'Professional English Test: assessment', 'One certified attempt, a score report and a certificate.', 0, 1, 30, 1, 33),
  ('assess_placement', 'assessment', 'placement', 'English Placement Test: assessment', 'One attempt to find your level, with a score report.', 0, 1, 30, 1, 34),
  ('level_test', 'level', NULL, 'Level certificate test (A1–C2)', 'One certified attempt at the level you choose. Pass it and get that level''s certificate.', 0, 1, 30, 1, 40);

-- 2. What each person owns besides a licence (a licence or the Plus plan is
--    "Full access" already). One row per purchase, credit or grant.
CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id),
  -- Copied from the product (a prep or assessment test) or chosen (a level test).
  test_type_id text REFERENCES test_types(id),
  level text CHECK (level IS NULL OR level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  attempts_total integer NOT NULL DEFAULT 0,
  attempts_used integer NOT NULL DEFAULT 0 CHECK (attempts_used >= 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  -- purchase (individual paid), credit (an organisation sent it), grant (staff).
  source text NOT NULL CHECK (source IN ('purchase', 'credit', 'grant')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_entitlements_user ON entitlements(user_id, ends_at DESC) WHERE revoked_at IS NULL;

-- Down Migration
DROP TABLE IF EXISTS entitlements;
DROP TABLE IF EXISTS products;
