-- Up Migration
-- Group leaderboards: an org admin turns one on per batch (off by default);
-- a learner can hide their name on it.
ALTER TABLE batches ADD COLUMN leaderboard_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN leaderboard_hidden boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE users DROP COLUMN leaderboard_hidden;
ALTER TABLE batches DROP COLUMN leaderboard_enabled;
