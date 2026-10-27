-- Up Migration
-- Coached practice in the AI Coach: a turn can carry a question card, the
-- learner's answer or a result card, so a resumed chat draws them again.
ALTER TABLE coach_turns ADD COLUMN payload jsonb;

-- Down Migration
ALTER TABLE coach_turns DROP COLUMN IF EXISTS payload;
