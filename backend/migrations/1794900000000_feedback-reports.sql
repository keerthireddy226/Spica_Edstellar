-- Up Migration
-- The AI feedback report after a practice test or mock (ASSESSMENT_ENGINE.md
-- section 7), built in the background from the stored results.
CREATE TABLE feedback_reports (
  session_id    uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  -- summary: levels and next steps; full: also every question reviewed.
  report_level  text NOT NULL DEFAULT 'full' CHECK (report_level IN ('summary', 'full')),
  report        jsonb,
  model         text,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE IF EXISTS feedback_reports;
