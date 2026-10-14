-- Up Migration
-- Phase 1 data foundation: participant IDs, learner demographics (consented,
-- optional where sensitive), persisted UI language, org billing/location
-- fields, batch IDs + CEFR goals, and a batch-move history.

-- Participant ID: SPC-YY-NNNNNN, one global sequence, never reused. Assigned
-- by trigger so every creation path (signup, invite, bulk CSV, seeds) gets
-- one without each call site having to remember.
CREATE SEQUENCE participant_id_seq;

ALTER TABLE users ADD COLUMN participant_id text UNIQUE;
ALTER TABLE users ADD COLUMN preferred_language text;

CREATE FUNCTION assign_participant_id() RETURNS trigger AS $$
BEGIN
  IF NEW.role = 'learner' AND NEW.participant_id IS NULL THEN
    NEW.participant_id := 'SPC-' || to_char(coalesce(NEW.created_at, now()), 'YY') || '-' ||
      lpad(nextval('participant_id_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assign_participant_id
  BEFORE INSERT OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION assign_participant_id();

-- Backfill existing learners in signup order.
UPDATE users u SET participant_id = 'SPC-' || to_char(u.created_at, 'YY') || '-' || lpad(nextval('participant_id_seq')::text, 6, '0')
FROM (SELECT id FROM users WHERE role = 'learner' AND participant_id IS NULL ORDER BY created_at) ordered
WHERE u.id = ordered.id;

-- Learner demographics. Gender and age are optional and stored coarse
-- (age as a band, never a birthdate) to keep DPDP/GDPR exposure minimal.
ALTER TABLE participant_profiles ADD COLUMN country text;
ALTER TABLE participant_profiles ADD COLUMN city text;
ALTER TABLE participant_profiles ADD COLUMN job_role text;
ALTER TABLE participant_profiles ADD COLUMN gender text
  CHECK (gender IS NULL OR gender IN ('female', 'male', 'non_binary', 'prefer_not'));
ALTER TABLE participant_profiles ADD COLUMN age_band text
  CHECK (age_band IS NULL OR age_band IN ('under_18', '18_24', '25_34', '35_44', '45_54', '55_plus'));

ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN ('recording', 'training_use', 'voice_identity', 'face_identity', 'demographics'));

-- Organization location + billing.
ALTER TABLE tenants ADD COLUMN country text;
ALTER TABLE tenants ADD COLUMN billing_contact_name text;
ALTER TABLE tenants ADD COLUMN billing_contact_email text;
ALTER TABLE tenants ADD COLUMN tax_id text;

-- Batch ID (BAT-YY-NNNN) + CEFR goal. Target date is derived from
-- start_date + duration_months rather than stored a second time.
CREATE SEQUENCE batch_code_seq;
ALTER TABLE batches ADD COLUMN batch_code text UNIQUE;
ALTER TABLE batches ADD COLUMN start_cefr text CHECK (start_cefr IS NULL OR start_cefr IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'));
ALTER TABLE batches ADD COLUMN target_cefr text CHECK (target_cefr IS NULL OR target_cefr IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'));

CREATE FUNCTION assign_batch_code() RETURNS trigger AS $$
BEGIN
  IF NEW.batch_code IS NULL THEN
    NEW.batch_code := 'BAT-' || to_char(coalesce(NEW.created_at, now()), 'YY') || '-' ||
      lpad(nextval('batch_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assign_batch_code
  BEFORE INSERT ON batches
  FOR EACH ROW EXECUTE FUNCTION assign_batch_code();

UPDATE batches b SET batch_code = 'BAT-' || to_char(b.created_at, 'YY') || '-' || lpad(nextval('batch_code_seq')::text, 4, '0')
FROM (SELECT id FROM batches WHERE batch_code IS NULL ORDER BY created_at) ordered
WHERE b.id = ordered.id;

-- A learner is in at most one batch (users.batch_id); moving between batches
-- is recorded here so history survives the move.
CREATE TABLE batch_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_batch_id uuid REFERENCES batches(id) ON DELETE SET NULL,
  to_batch_id uuid REFERENCES batches(id) ON DELETE SET NULL,
  from_batch_name text,
  to_batch_name text,
  moved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  moved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_batch_moves_user_id ON batch_moves(user_id);

-- Down Migration
DROP TABLE batch_moves;
DROP TRIGGER trg_assign_batch_code ON batches;
DROP FUNCTION assign_batch_code();
ALTER TABLE batches DROP COLUMN batch_code, DROP COLUMN start_cefr, DROP COLUMN target_cefr;
DROP SEQUENCE batch_code_seq;
ALTER TABLE tenants DROP COLUMN country, DROP COLUMN billing_contact_name, DROP COLUMN billing_contact_email, DROP COLUMN tax_id;
ALTER TABLE consent_records DROP CONSTRAINT consent_records_consent_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN ('recording', 'training_use', 'voice_identity', 'face_identity'));
ALTER TABLE participant_profiles DROP COLUMN country, DROP COLUMN city, DROP COLUMN job_role, DROP COLUMN gender, DROP COLUMN age_band;
DROP TRIGGER trg_assign_participant_id ON users;
DROP FUNCTION assign_participant_id();
ALTER TABLE users DROP COLUMN participant_id, DROP COLUMN preferred_language;
DROP SEQUENCE participant_id_seq;
