-- Up Migration
-- Questions written only for level tests: never in Practice Modules, practice
-- tests or mock tests, so a level test shows questions nobody has practised.
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_pool_check;
ALTER TABLE items ADD CONSTRAINT items_pool_check CHECK (pool IN ('placement', 'practice', 'exam', 'level_test'));

-- Down Migration
DELETE FROM item_audio WHERE item_id IN (SELECT id FROM items WHERE pool = 'level_test');
DELETE FROM items WHERE pool = 'level_test';
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_pool_check;
ALTER TABLE items ADD CONSTRAINT items_pool_check CHECK (pool IN ('placement', 'practice', 'exam'));
