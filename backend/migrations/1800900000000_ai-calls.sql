-- Up Migration
-- Every Gemini call with its tokens and cost (from 17 Nov 2026), to measure
-- what each plan really costs to deliver. Logged by src/ai/usageLog.ts.
CREATE TABLE ai_calls (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  model text NOT NULL,
  -- What the call was for: grading, speaking-audio, report, coach, generation, question-check, embedding.
  purpose text NOT NULL,
  -- The request that made it (method and route), when there was one.
  route text,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  audio_input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  thinking_tokens integer NOT NULL DEFAULT 0,
  -- US$ at the price list in usageLog.ts when the call was made (null: model not priced).
  cost_usd numeric(12, 7),
  duration_ms integer,
  ok boolean NOT NULL DEFAULT true
);
CREATE INDEX ai_calls_created_idx ON ai_calls (created_at);
CREATE INDEX ai_calls_user_idx ON ai_calls (user_id, created_at);
CREATE INDEX ai_calls_session_idx ON ai_calls (session_id);

-- Down Migration
DROP TABLE ai_calls;
