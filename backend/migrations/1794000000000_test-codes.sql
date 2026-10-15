-- Up Migration
-- Every test attempt (mock exam or placement test) gets a short ID people
-- can quote: on the score report, in integrity reviews, on a candidate's
-- report. "FS-7K3M-9QX2": two letters for the test, then 8 characters
-- without look-alikes (no 0/O, 1/I).
ALTER TABLE sessions ADD COLUMN test_code text;

CREATE OR REPLACE FUNCTION pg_temp.random_code() RETURNS text AS $$
  SELECT string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1), '')
  FROM generate_series(1, 8)
$$ LANGUAGE sql VOLATILE;

-- Attempts made before this change get one too.
UPDATE sessions s SET test_code =
  (CASE
     WHEN s.session_type = 'placement' THEN 'AP'
     ELSE coalesce((SELECT CASE split_part(e.code, '-', 1)
                             WHEN 'fourskills' THEN 'FS' WHEN 'speaklisten' THEN 'SL' WHEN 'writing' THEN 'WR'
                             WHEN 'professional' THEN 'PR' WHEN 'placement' THEN 'PL' END
                           FROM exams e WHERE e.id::text = s.composition->>'examId'), 'MT')
   END) || '-' || overlay(pg_temp.random_code() placing '-' from 5 for 0)
WHERE s.session_type IN ('placement', 'mocktest');

CREATE UNIQUE INDEX uq_sessions_test_code ON sessions (test_code) WHERE test_code IS NOT NULL;

-- Down Migration
DROP INDEX uq_sessions_test_code;
ALTER TABLE sessions DROP COLUMN test_code;
