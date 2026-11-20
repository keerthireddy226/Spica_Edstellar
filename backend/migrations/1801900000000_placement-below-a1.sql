-- Up Migration
-- A placement result can now be Below A1 ("Pre-A1") when not even A1 is
-- passed (owner decision 19 Nov 2026); it used to show A1 for 0% right.
ALTER TABLE placements DROP CONSTRAINT placements_cefr_level_check;
ALTER TABLE placements ADD CONSTRAINT placements_cefr_level_check
  CHECK (cefr_level = ANY (ARRAY['Pre-A1'::text, 'A1'::text, 'A2'::text, 'B1'::text, 'B2'::text, 'C1'::text, 'C2'::text]));

-- Down Migration
UPDATE placements SET cefr_level = 'A1' WHERE cefr_level = 'Pre-A1';
ALTER TABLE placements DROP CONSTRAINT placements_cefr_level_check;
ALTER TABLE placements ADD CONSTRAINT placements_cefr_level_check
  CHECK (cefr_level = ANY (ARRAY['A1'::text, 'A2'::text, 'B1'::text, 'B2'::text, 'C1'::text, 'C2'::text]));
