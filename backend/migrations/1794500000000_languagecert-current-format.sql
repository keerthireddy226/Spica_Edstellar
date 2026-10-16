-- Up Migration
-- LanguageCert's current published formats (checked 2026-10-16 on
-- languagecert.org): Writing A1-C2 is now 30 minutes and 1 task (a 200-250
-- word report, article or review); the older 60-minute, two-task format is
-- retired. Each test type also lists its delivery formats and their times.

-- Delivery formats and times, e.g. [{"kind":"paper","min":120,"max":120},
-- {"kind":"computer","min":60,"max":90}]. duration_minutes stays the time of
-- the format Spica's sets model (paper).
ALTER TABLE test_types ADD COLUMN formats jsonb;

UPDATE test_types SET duration_minutes = 120, formats = '[{"kind":"paper","min":120,"max":120},{"kind":"computer","min":60,"max":90}]' WHERE id = 'lcListeningReading';
UPDATE test_types SET duration_minutes = 70, formats = '[{"kind":"paper","min":70,"max":70}]' WHERE id = 'lcListeningReadingLower';
UPDATE test_types SET duration_minutes = 30, formats = '[{"kind":"paper","min":30,"max":30},{"kind":"computer","min":30,"max":30}]' WHERE id = 'lcWriting';
UPDATE test_types SET duration_minutes = 14, formats = '[{"kind":"face_to_face","min":10,"max":14},{"kind":"online","min":10,"max":14}]' WHERE id = 'lcSpeaking';
-- 4 skills = the three modules: paper 120 + 30 + 10-14; computer 60-90 + 30 + 10-14.
UPDATE test_types SET duration_minutes = 164, formats = '[{"kind":"paper","min":160,"max":164},{"kind":"computer","min":100,"max":134}]' WHERE id = 'lcFourSkills';

-- Writing: one task.
UPDATE item_types SET name = 'Writing Task', timer_seconds = 1800, estimated_seconds = 1800,
  instruction_text = 'Write a short report, article or review on the topic. Write 200 to 250 words.'
WHERE id = 'lc_write_task2';
DELETE FROM blueprint_sections WHERE item_type_id = 'lc_write_task1';
UPDATE blueprint_sections SET label = 'Writing: Report, article or review', minutes = 30 WHERE item_type_id = 'lc_write_task2';
-- Close the gap the removed task left in the 4 skills order (moved out of the
-- way first, as sort_order is unique per test type).
UPDATE blueprint_sections SET sort_order = sort_order + 1000 WHERE test_type_id IN ('lcWriting', 'lcFourSkills');
UPDATE blueprint_sections b SET sort_order = r.n
FROM (SELECT id, row_number() OVER (PARTITION BY test_type_id ORDER BY sort_order) AS n FROM blueprint_sections WHERE test_type_id IN ('lcWriting', 'lcFourSkills')) r
WHERE b.id = r.id;

-- Existing sets: the short-message task is retired, the other task renamed.
UPDATE items SET status = 'retired', updated_at = now() WHERE item_type_id = 'lc_write_task1' AND status = 'approved';
UPDATE exam_parts SET part_label = 'Writing: Report, article or review' WHERE item_type_id = 'lc_write_task2';

-- A question's own time limit, when its test needs a different one from its
-- type's default (the A1-B1 Reading has 40 minutes, the A1-C2 Reading 70).
ALTER TABLE items ADD COLUMN timer_seconds integer;

-- Reading time limits sized so A1-C2 Reading adds up to 70 minutes
-- (7 x 70 + 3 x 340 + 23 x 45 + 3 x 550 = 4,195 s).
UPDATE item_types SET timer_seconds = 70 WHERE id = 'lc_read_short';
UPDATE item_types SET timer_seconds = 340 WHERE id = 'lc_read_cloze';
UPDATE item_types SET timer_seconds = 45 WHERE id = 'lc_read_gap';
UPDATE item_types SET timer_seconds = 550 WHERE id = 'lc_read_long';
-- A1-B1 Reading: 40 minutes (8 x 45 + 3 x 260 + 7 x 30 + 2 x 540 = 2,430 s).
UPDATE items i SET timer_seconds = CASE i.item_type_id
    WHEN 'lc_read_short' THEN 45 WHEN 'lc_read_cloze' THEN 260 WHEN 'lc_read_gap' THEN 30 WHEN 'lc_read_long' THEN 540 END
FROM exam_parts ep JOIN exams e ON e.id = ep.exam_id
WHERE i.exam_part_id = ep.id AND e.test_type_id = 'lcListeningReadingLower' AND i.item_type_id LIKE 'lc\_read\_%';

-- Down Migration
UPDATE item_types SET timer_seconds = 60 WHERE id = 'lc_read_short';
UPDATE item_types SET timer_seconds = 300 WHERE id = 'lc_read_cloze';
UPDATE item_types SET timer_seconds = 40 WHERE id = 'lc_read_gap';
UPDATE item_types SET timer_seconds = 480 WHERE id = 'lc_read_long';
ALTER TABLE items DROP COLUMN timer_seconds;
UPDATE items SET status = 'approved' WHERE item_type_id = 'lc_write_task1' AND status = 'retired';
UPDATE exam_parts SET part_label = 'Task 2: Report, article or review' WHERE item_type_id = 'lc_write_task2';
UPDATE item_types SET name = 'Writing Task 2', timer_seconds = 2400, estimated_seconds = 2400 WHERE id = 'lc_write_task2';
ALTER TABLE test_types DROP COLUMN formats;
UPDATE test_types SET duration_minutes = 60 WHERE id = 'lcWriting';
UPDATE test_types SET duration_minutes = 194 WHERE id = 'lcFourSkills';
-- The removed Writing Task 1 sections are not restored; re-run 1794400000000 for them.
