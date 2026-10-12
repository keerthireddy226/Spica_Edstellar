-- Up Migration
-- A multi-skill item type (e.g. "conversations" tagged {speaking,listening})
-- showed up under both Modules skill tabs pointing at the exact same
-- units/sets/content underneath — not duplicated material, just the same
-- questions cross-listed. This column lets each individual item be reserved
-- for one specific skill within its type, so Listening and Speaking (etc.)
-- get genuinely non-overlapping question sets instead of sharing one pool.
-- NULL means "not partitioned" — true for every single-skill item type,
-- where there's nothing to split.
ALTER TABLE items ADD COLUMN skill_tag text;

-- Down Migration
ALTER TABLE items DROP COLUMN skill_tag;
