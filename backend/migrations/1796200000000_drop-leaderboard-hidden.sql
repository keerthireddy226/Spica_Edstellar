-- Up Migration
-- Learners now appear to peers by Learner ID only, so there's no name to hide.
ALTER TABLE users DROP COLUMN leaderboard_hidden;

-- Down Migration
ALTER TABLE users ADD COLUMN leaderboard_hidden boolean NOT NULL DEFAULT false;
