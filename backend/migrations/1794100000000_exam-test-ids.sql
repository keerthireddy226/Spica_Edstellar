-- Up Migration
-- A fixed, public ID for every test set, shown on the test cards: two letters
-- for the product and the set number, e.g. "SL-001" = Speaking & Listening,
-- Set 1. (Each attempt has its own sessions.test_code.)
ALTER TABLE exams ADD COLUMN test_id text;

CREATE FUNCTION exam_test_id(code text) RETURNS text AS $$
  SELECT (CASE split_part(code, '-', 1)
            WHEN 'fourskills' THEN 'FS' WHEN 'speaklisten' THEN 'SL' WHEN 'writing' THEN 'WR'
            WHEN 'professional' THEN 'PR' WHEN 'placement' THEN 'PL' ELSE upper(left(code, 2)) END)
         || '-' || lpad(coalesce(nullif(regexp_replace(code, '^.*-', ''), ''), '0'), 3, '0')
$$ LANGUAGE sql IMMUTABLE;

UPDATE exams SET test_id = exam_test_id(code);
ALTER TABLE exams ALTER COLUMN test_id SET NOT NULL;
CREATE UNIQUE INDEX uq_exams_test_id ON exams (test_id);

-- Sets added later get their ID from their code automatically.
CREATE FUNCTION exams_set_test_id() RETURNS trigger AS $$
BEGIN
  IF NEW.test_id IS NULL THEN NEW.test_id := exam_test_id(NEW.code); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_exams_test_id BEFORE INSERT ON exams FOR EACH ROW EXECUTE FUNCTION exams_set_test_id();

-- Down Migration
DROP TRIGGER trg_exams_test_id ON exams;
DROP FUNCTION exams_set_test_id();
DROP INDEX uq_exams_test_id;
ALTER TABLE exams DROP COLUMN test_id;
DROP FUNCTION exam_test_id(text);
