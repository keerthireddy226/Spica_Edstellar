-- Up Migration
-- Practice tests run in one of two modes (see ASSESSMENT_ENGINE.md section 5):
--   practice: pause and resume, go back, feedback after each answer, light monitoring;
--   mock:     exam conditions; each question's time runs from when it is first
--             shown (session_item_views) and the server enforces it.

ALTER TABLE sessions ADD COLUMN delivery_mode text CHECK (delivery_mode IN ('practice', 'mock'));
-- Existing practice-test sessions were practice; candidates' assessments are exams.
UPDATE sessions SET delivery_mode = 'practice' WHERE session_type = 'mocktest';
UPDATE sessions s SET delivery_mode = 'mock' FROM recruitment_assessments ra WHERE ra.session_id = s.id AND s.session_type = 'mocktest';

CREATE TABLE session_item_views (
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES items(id),
  shown_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, item_id)
);

-- The AI grader's one-sentence reason for a score: shown as feedback after a
-- practice question, and kept for the report.
ALTER TABLE scores ADD COLUMN reason text;

-- Down Migration
ALTER TABLE scores DROP COLUMN IF EXISTS reason;
DROP TABLE session_item_views;
ALTER TABLE sessions DROP COLUMN delivery_mode;
