import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";
import { gradeAttempt, type GradeResult } from "./placement/grading.js";
import { computeFluencySignals, isTrulyCorrect, type StoredMannerScores } from "./placement/fluencySignals.js";
import { scoreAudioFluency } from "./placement/geminiFluency.js";
import { passThresholdForLevel } from "./placement/cefr.js";

export const UPLOADS_DIR = path.join(process.cwd(), "uploads", "attempts");

export interface AttemptBody {
  itemId: string;
  responseText?: string;
  audioBase64?: string;
  audioMimeType?: string;
  durationMs?: number;
  // Real time spent on this question (shown -> submitted), client-tracked —
  // see the migration adding this column for why window_start_at/submitted_at
  // can't answer this themselves.
  activeMs?: number;
}

export interface GradedItem {
  item_type_id: string;
  answer_set: unknown;
  content: unknown;
  cefr_level: string | null;
  min_words: number | null;
  input_method: string;
}

export interface GradedAttempt {
  attemptId: string;
  item: GradedItem;
  grade: GradeResult;
  mannerScores: StoredMannerScores | null;
  // Raw isTrulyCorrect() result, always a definite boolean regardless of
  // grade.status — placement's adaptive engine steps on this even for a
  // "pending"/"failed" grade; callers gate it by grade.status for their own
  // response's `correct` field.
  wasCorrect: boolean;
}

// Shared by placement/practice attempt submission: loads item, grades, records score.
export async function gradeAndSaveAttempt(sessionId: string, body: AttemptBody): Promise<GradedAttempt | null> {
  const itemResult = await pool.query(
    `SELECT i.item_type_id, i.answer_set, i.content, i.cefr_level, it.min_words, it.input_method
     FROM items i JOIN item_types it ON it.id = i.item_type_id
     WHERE i.id = $1`,
    [body.itemId],
  );
  const item: GradedItem | undefined = itemResult.rows[0];
  if (!item) return null;

  // Best-effort lookup for cleaning up the old recording file below — not
  // relied on for correctness (that's the DB unique constraint + UPSERT).
  const priorResult = await pool.query(`SELECT response_uri FROM attempts WHERE session_id = $1 AND item_id = $2`, [
    sessionId,
    body.itemId,
  ]);
  const priorResponseUri: string | null = priorResult.rows[0]?.response_uri ?? null;

  let responseUri: string | null = null;
  if (body.audioBase64) {
    await mkdir(UPLOADS_DIR, { recursive: true });
    const ext = body.audioMimeType?.includes("mp4") ? "m4a" : "webm";
    const fileName = `${randomUUID()}.${ext}`;
    await writeFile(path.join(UPLOADS_DIR, fileName), Buffer.from(body.audioBase64, "base64"));
    responseUri = `/uploads/attempts/${fileName}`;
  }

  // Real pronunciation/fluency scoring from the recording itself — needs a recording + GEMINI_API_KEY, fails closed.
  // Run before grading (not after, as it used to be) because its transcript
  // is also the fallback content-grading text below.
  const geminiScores =
    item.input_method === "mic" && body.audioBase64
      ? await scoreAudioFluency(body.audioBase64, body.audioMimeType ?? "audio/webm", item.cefr_level)
      : null;

  // A spoken answer is graded on Gemini's transcript of the recording: the
  // browser's speech-to-text is tuned to one accent and mishears others, so
  // it's only the fallback (no API key, a failed call, or nothing heard).
  const effectiveResponseText = (item.input_method === "mic" ? geminiScores?.transcript || body.responseText : body.responseText) || undefined;

  // Recording is saved for playback/review, but grading itself runs on the transcript only (see aiGrading.ts).
  const grade = await gradeAttempt(
    item.item_type_id,
    item.answer_set,
    item.content,
    item.cefr_level,
    item.min_words,
    effectiveResponseText,
  );
  const responseText = effectiveResponseText ?? null;

  // Resubmitting the same item in a session replaces the old attempt instead
  // of stacking a second one — an UPSERT (backed by a unique index on
  // (session_id, item_id)) so two concurrent submissions for the same
  // question can't each insert their own row; Postgres serializes them and
  // the later one simply overwrites the earlier one's columns.
  const attemptResult = await pool.query(
    `INSERT INTO attempts (session_id, item_id, window_start_at, submitted_at, response_uri, response_text, active_ms)
     VALUES ($1, $2, now(), now(), $3, $4, $5)
     ON CONFLICT (session_id, item_id) DO UPDATE SET
       window_start_at = now(), submitted_at = now(), response_uri = EXCLUDED.response_uri,
       response_text = EXCLUDED.response_text, active_ms = EXCLUDED.active_ms
     RETURNING id`,
    [sessionId, body.itemId, responseUri, responseText, body.activeMs ?? null],
  );
  const attemptId = attemptResult.rows[0].id;

  // The old recording (if replaced) is now orphaned — best-effort cleanup,
  // not correctness-critical (see the comment on priorResponseUri above).
  if (priorResponseUri && priorResponseUri !== responseUri) {
    const fileName = path.basename(priorResponseUri);
    await unlink(path.join(UPLOADS_DIR, fileName)).catch(() => {
      // best-effort cleanup — a missing file isn't worth failing the resubmit over
    });
  }

  // model_version is NOT NULL, so a genuinely ungraded (pending/failed, no
  // method) attempt gets an honest "n/a" instead of falsely claiming
  // exact-match-v1 was the method used.
  const modelVersion =
    grade.method === "ai-text"
      ? "gemini-3.5-flash-lite-v1"
      : grade.method === "text-diff"
        ? "text-diff-v1"
        : grade.method === "exact-match"
          ? "exact-match-v1"
          : "n/a";

  // Free fluency signals (rate, fillers) from transcript/duration alone — describes delivery, not correctness.
  const freeSignals = item.input_method === "mic" && responseText ? computeFluencySignals(responseText, body.durationMs) : null;

  const mannerScores = freeSignals || geminiScores ? { ...freeSignals, gemini: geminiScores ?? undefined } : null;

  // Same UPSERT reasoning as attempts above (backed by a unique index on
  // attempt_id) — two concurrent gradings of the same attempt can't each
  // insert their own scores row.
  await pool.query(
    `INSERT INTO scores (attempt_id, content_score, manner_scores, status, model_version) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (attempt_id) DO UPDATE SET
       content_score = EXCLUDED.content_score, manner_scores = EXCLUDED.manner_scores,
       status = EXCLUDED.status, model_version = EXCLUDED.model_version, updated_at = now()`,
    [attemptId, grade.score, mannerScores ? JSON.stringify(mannerScores) : null, grade.status, modelVersion],
  );

  // For mic answers, "correct" also requires pronunciation/fluency/pace, not just content.
  const wasCorrect = isTrulyCorrect(grade.score, item.cefr_level, item.input_method, mannerScores, passThresholdForLevel);

  return { attemptId, item, grade, mannerScores, wasCorrect };
}
