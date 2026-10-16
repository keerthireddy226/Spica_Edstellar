-- Up Migration
-- The exam catalogue: exam families (Versant, LanguageCert, ...), their test
-- types, and each test type's sections (its blueprint). Replaces the product
-- list that was written into the code. Existing practice-test sets ("exams")
-- become fixed forms of a test type. See ASSESSMENT_ENGINE.md.

CREATE TABLE exam_families (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  publisher   text NOT NULL,
  -- Spica prepares people for these exams; it never gives their official scores.
  delivery    text NOT NULL CHECK (delivery IN ('fixed', 'adaptive')),
  -- Publisher's score scale and its CEFR bands, where public; null = CEFR only.
  score_scale jsonb,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE test_types (
  -- Kept equal to the old product ids ("fourSkills", ...) so organization
  -- settings and recruitment tests that store them keep working.
  id               text PRIMARY KEY,
  family_id        text NOT NULL REFERENCES exam_families(id),
  name             text NOT NULL,
  skills           text[] NOT NULL,
  cefr_min         text NOT NULL,
  cefr_max         text NOT NULL,
  duration_minutes integer NOT NULL,
  delivery         text NOT NULL CHECK (delivery IN ('fixed', 'adaptive')),
  status           text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'coming_soon', 'retired')),
  -- Sets of this type are exams whose code starts with "<prefix>-".
  exam_code_prefix text NOT NULL UNIQUE,
  sort_order       integer NOT NULL DEFAULT 0
);

CREATE TABLE blueprint_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_type_id text NOT NULL REFERENCES test_types(id) ON DELETE CASCADE,
  sort_order   integer NOT NULL,
  label        text NOT NULL,
  -- Null while the section's question type isn't built yet.
  item_type_id text REFERENCES item_types(id),
  item_count   integer NOT NULL CHECK (item_count > 0),
  -- Guide time for the section; null = timed per question.
  minutes      integer,
  UNIQUE (test_type_id, sort_order)
);

INSERT INTO exam_families (id, name, publisher, delivery, score_scale, sort_order) VALUES
  ('versant', 'Versant', 'Pearson', 'fixed', NULL, 1),
  -- LanguageCert Test of English (LTE): scores out of 100 mapped to CEFR.
  ('languagecert', 'LanguageCert', 'LanguageCert / PeopleCert', 'fixed',
   '{"min": 0, "max": 100, "bands": [{"level": "C2", "from": 90}, {"level": "C1", "from": 75}, {"level": "B2", "from": 60}, {"level": "B1", "from": 40}, {"level": "A2", "from": 20}, {"level": "A1", "from": 10}]}',
   2);

INSERT INTO test_types (id, family_id, name, skills, cefr_min, cefr_max, duration_minutes, delivery, status, exam_code_prefix, sort_order) VALUES
  ('speakingListening', 'versant', 'English Speaking and Listening Test', '{speaking,listening}', 'A1', 'C2', 17, 'fixed', 'live', 'speaklisten', 1),
  ('fourSkills', 'versant', 'English 4-Skills Essentials Test', '{speaking,listening,reading,writing}', 'A1', 'C2', 30, 'fixed', 'live', 'fourskills', 2),
  ('writing', 'versant', 'English Writing Test', '{writing,listening,reading}', 'A1', 'C2', 35, 'fixed', 'live', 'writing', 3),
  ('professional', 'versant', 'Professional English Test', '{speaking,listening,reading,writing}', 'A1', 'C2', 60, 'fixed', 'live', 'professional', 4),
  ('placement', 'versant', 'English Placement Test', '{speaking,listening,reading,writing}', 'A1', 'C2', 50, 'fixed', 'live', 'placement', 5),
  -- LanguageCert Test of English (LTE), modelled on the paper-based versions
  -- (the A1-C2 Listening & Reading is also offered as an adaptive computer
  -- test; that comes with the adaptive engine). Timings and counts from the
  -- LTE Qualification Handbooks (Listening & Reading v9.0, Speaking v4.0,
  -- October 2025).
  ('lcListeningReading', 'languagecert', 'Listening & Reading (A1-C2)', '{listening,reading}', 'A1', 'C2', 120, 'fixed', 'coming_soon', 'lclr', 11),
  ('lcListeningReadingLower', 'languagecert', 'Listening & Reading (A1-B1)', '{listening,reading}', 'A1', 'B1', 70, 'fixed', 'coming_soon', 'lclrb', 12),
  ('lcWriting', 'languagecert', 'Writing (A1-C2)', '{writing}', 'A1', 'C2', 60, 'fixed', 'coming_soon', 'lcwr', 13),
  ('lcSpeaking', 'languagecert', 'Speaking (A1-C2)', '{speaking}', 'A1', 'C2', 14, 'fixed', 'coming_soon', 'lcsp', 14),
  ('lcFourSkills', 'languagecert', '4 Skills (A1-C2)', '{listening,reading,writing,speaking}', 'A1', 'C2', 194, 'fixed', 'coming_soon', 'lc4s', 15);

-- Versant blueprints: the sections of each product's first set, as they are.
INSERT INTO blueprint_sections (test_type_id, sort_order, label, item_type_id, item_count)
SELECT tt.id, ep.sort_order, ep.part_label, ep.item_type_id, count(i.id)::int
FROM test_types tt
JOIN exams e ON e.code = tt.exam_code_prefix || '-1'
JOIN exam_parts ep ON ep.exam_id = e.id
LEFT JOIN items i ON i.exam_part_id = ep.id AND i.status = 'approved'
WHERE tt.family_id = 'versant'
GROUP BY tt.id, ep.sort_order, ep.part_label, ep.item_type_id
HAVING count(i.id) > 0;

-- Each existing set is a fixed form of its test type.
ALTER TABLE exams ADD COLUMN test_type_id text REFERENCES test_types(id);
UPDATE exams e SET test_type_id = tt.id FROM test_types tt WHERE e.code LIKE tt.exam_code_prefix || '-%';
CREATE INDEX idx_exams_test_type ON exams (test_type_id);

-- Test IDs for LanguageCert sets: LR-001, LB-001, LW-001, LS-001, L4-001.
CREATE OR REPLACE FUNCTION exam_test_id(code text) RETURNS text AS $$
  SELECT (CASE split_part(code, '-', 1)
            WHEN 'fourskills' THEN 'FS' WHEN 'speaklisten' THEN 'SL' WHEN 'writing' THEN 'WR'
            WHEN 'professional' THEN 'PR' WHEN 'placement' THEN 'PL'
            WHEN 'lclr' THEN 'LR' WHEN 'lclrb' THEN 'LB' WHEN 'lcwr' THEN 'LW' WHEN 'lcsp' THEN 'LS' WHEN 'lc4s' THEN 'L4'
            ELSE upper(left(code, 2)) END)
         || '-' || lpad(coalesce(nullif(regexp_replace(code, '^.*-', ''), ''), '0'), 3, '0')
$$ LANGUAGE sql IMMUTABLE;

-- Down Migration
CREATE OR REPLACE FUNCTION exam_test_id(code text) RETURNS text AS $$
  SELECT (CASE split_part(code, '-', 1)
            WHEN 'fourskills' THEN 'FS' WHEN 'speaklisten' THEN 'SL' WHEN 'writing' THEN 'WR'
            WHEN 'professional' THEN 'PR' WHEN 'placement' THEN 'PL' ELSE upper(left(code, 2)) END)
         || '-' || lpad(coalesce(nullif(regexp_replace(code, '^.*-', ''), ''), '0'), 3, '0')
$$ LANGUAGE sql IMMUTABLE;
DROP INDEX idx_exams_test_type;
ALTER TABLE exams DROP COLUMN test_type_id;
DROP TABLE blueprint_sections;
DROP TABLE test_types;
DROP TABLE exam_families;
