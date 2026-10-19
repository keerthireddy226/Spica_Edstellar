-- Up Migration
-- The level each learner works at in each Practice Modules question type and
-- skill ("My path"): seeded from the level test, moved up after a level's
-- sets are done well, down after weak sets, and raised by mock exams.
CREATE TABLE learner_type_levels (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type_id text NOT NULL REFERENCES item_types(id) ON DELETE CASCADE,
  skill text NOT NULL CHECK (skill IN ('listening', 'speaking', 'reading', 'writing')),
  level text NOT NULL CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  -- What set the level last: placement, progress (sets), mock.
  source text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_type_id, skill)
);

-- Down Migration
DROP TABLE learner_type_levels;
