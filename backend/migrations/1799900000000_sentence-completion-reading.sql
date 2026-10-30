-- Up Migration
-- Sentence Completion is read as well as written: it counts toward Reading
-- too, so a test's Reading score rests on many questions, not only the one or
-- two Passage Reconstruction passages.
UPDATE item_types SET skills = ARRAY['reading', 'writing'] WHERE id = 'sentence_completion' AND skills = ARRAY['writing'];

-- Down Migration
UPDATE item_types SET skills = ARRAY['writing'] WHERE id = 'sentence_completion' AND skills = ARRAY['reading', 'writing'];
