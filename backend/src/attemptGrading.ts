import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";
import { gradeAttempt, type GradeResult } from "./placement/grading.js";
import { computeFluencySignals, isTrulyCorrect, type StoredMannerScores } from "./placement/fluencySignals.js";
import { scoreAudioFluency } from "./placement/geminiFluency.js";
import { enqueue } from "./queue/queue.js";
import { measureAnswerNoise, recordNoisyAnswer, type AnswerNoise } from "./proctoring/answerAudio.js";
import { passThresholdForLevel } from "./placement/cefr.js";

export const UPLOADS_DIR = path.join(process.cwd(), "uploads", "attempts");

// Gemini listened and heard no speech, and the browser heard none either: the
// answer is empty, so it scores 0 like any empty answer instead of waiting
// for a grade that will never come.
const NO_SPEECH: GradeResult = { status: "scored", correct: false, score: 0, method: null };
const NO_SPEECH_VERSION = "no-speech-v1";

function heardNoSpeech(gemini: { transcript: string } | null, browserText: string | null | undefined): boolean {
  return !!gemini && !gemini.transcript.trim() && !browserText?.trim();
}

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
// deferSpeaking: a recorded answer is saved at once and graded in the
// background (gradeSpeakingAttempt), so a slow Gemini call never makes the
// learner wait or falls back to the browser's transcript. Only for tests that
// don't pick the next question from this answer (not the adaptive placement).
export async function gradeAndSaveAttempt(sessionId: string, body: AttemptBody, opts: { deferSpeaking?: boolean } = {}): Promise<GradedAttempt | null> {
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

  const deferred = !!opts.deferSpeaking && item.input_method === "mic" && !!body.audioBase64;

  // Real pronunciation/fluency scoring from the recording itself — needs a recording + GEMINI_API_KEY, fails closed.
  // Run before grading (not after, as it used to be) because its transcript
  // is also the fallback content-grading text below.
  const geminiScores =
    item.input_method === "mic" && body.audioBase64 && !deferred
      ? await scoreAudioFluency(body.audioBase64, body.audioMimeType ?? "audio/webm", item.cefr_level)
      : null;

  // A spoken answer is graded on Gemini's transcript of the recording: the
  // browser's speech-to-text is tuned to one accent and mishears others, so
  // it's only the fallback (no API key, a failed call, or nothing heard).
  const effectiveResponseText = (item.input_method === "mic" ? geminiScores?.transcript || body.responseText : body.responseText) || undefined;

  // Recording is saved for playback/review, but grading itself runs on the transcript only (see aiGrading.ts).
  // Background noise in the recording, for the reviewer and the learner's feedback.
  const noise: AnswerNoise | null =
    item.input_method === "mic" && responseUri && !deferred
      ? await measureAnswerNoise(path.join(UPLOADS_DIR, path.basename(responseUri)))
      : null;

  const noSpeech = item.input_method === "mic" && heardNoSpeech(geminiScores, body.responseText);
  const grade: GradeResult = deferred
    ? { status: "pending", correct: null, score: null, method: null }
    : noSpeech
      ? NO_SPEECH
      : await gradeAttempt(item.item_type_id, item.answer_set, item.content, item.cefr_level, item.min_words, effectiveResponseText);
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
  const modelVersion = noSpeech
    ? NO_SPEECH_VERSION
    : grade.method === "ai-text"
      ? "gemini-3.5-flash-lite-v1"
      : grade.method === "text-diff"
        ? "text-diff-v1"
        : grade.method === "exact-match"
          ? "exact-match-v1"
          : "n/a";

  // Free fluency signals (rate, fillers) from transcript/duration alone — describes delivery, not correctness.
  const freeSignals = item.input_method === "mic" && responseText ? computeFluencySignals(responseText, body.durationMs) : null;

  // A deferred answer keeps its recording length for the background grader's pace check.
  const mannerScores = deferred
    ? { durationMs: body.durationMs ?? null }
    : freeSignals || geminiScores || noise
      ? { ...freeSignals, gemini: geminiScores ?? undefined, noise: noise ?? undefined }
      : null;

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

  if (noise && !noSpeech) await recordNoisyAnswer(sessionId, attemptId, noise).catch((err) => console.error("noisy answer record failed:", err));

  if (deferred && responseUri) {
    // Keyed by the recording, so re-recording an answer queues a fresh grading.
    await enqueue("grading.speaking", { attemptId }, { dedupeKey: `grading.speaking:${path.basename(responseUri)}`, maxAttempts: 4 });
  }

  // For mic answers, "correct" also requires pronunciation/fluency/pace, not just content.
  const wasCorrect = isTrulyCorrect(grade.score, item.cefr_level, item.input_method, mannerScores, passThresholdForLevel);

  return { attemptId, item, grade, mannerScores, wasCorrect };
}

const BACKGROUND_TIMEOUT_MS = 60_000;

// Grades a recorded answer that was saved without waiting for Gemini. Retried
// by the queue when Gemini doesn't answer; the last try (final) grades on the
// browser's transcript rather than leave the answer ungraded. Does nothing if
// the answer was already graded.
export async function gradeSpeakingAttempt(attemptId: string, opts: { final: boolean; timeoutMs?: number }): Promise<void> {
  const r = (
    await pool.query(
      `SELECT a.session_id, a.response_uri, a.response_text, sc.status, sc.manner_scores,
         i.item_type_id, i.answer_set, i.content, i.cefr_level, it.min_words, it.input_method
       FROM attempts a JOIN scores sc ON sc.attempt_id = a.id JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
       WHERE a.id = $1`,
      [attemptId],
    )
  ).rows[0];
  // Waiting for a grade, or a grading that failed (usually a Gemini timeout).
  if (!r || (r.status !== "pending" && r.status !== "failed")) return;
  if (!r.response_uri) return gradeTypedAnswerAgain(attemptId, r, opts.final, opts.timeoutMs ?? BACKGROUND_TIMEOUT_MS);

  const file = path.join(UPLOADS_DIR, path.basename(r.response_uri));
  const audio = await readFile(file).catch(() => null);
  const mime = file.endsWith(".m4a") ? "audio/mp4" : "audio/webm";
  const geminiScores = audio ? await scoreAudioFluency(audio.toString("base64"), mime, r.cefr_level, opts.timeoutMs ?? BACKGROUND_TIMEOUT_MS) : null;
  if (!geminiScores && !opts.final) throw new Error("speaking grading: Gemini didn't answer, will retry");

  const responseText: string | null = geminiScores?.transcript || r.response_text || null;
  const noSpeech = heardNoSpeech(geminiScores, r.response_text);
  const noise = audio ? await measureAnswerNoise(file) : null;
  const grade = noSpeech
    ? NO_SPEECH
    : await gradeAttempt(r.item_type_id, r.answer_set, r.content, r.cefr_level, r.min_words, responseText ?? undefined, opts.timeoutMs ?? BACKGROUND_TIMEOUT_MS);
  if (grade.status === "failed" && !opts.final) throw new Error("speaking grading: content grading didn't answer, will retry");
  const durationMs = r.manner_scores?.durationMs ?? null;
  const freeSignals = responseText ? computeFluencySignals(responseText, durationMs) : null;
  const mannerScores = freeSignals || geminiScores || noise ? { ...freeSignals, gemini: geminiScores ?? undefined, noise: noise ?? undefined } : null;
  const modelVersion = noSpeech ? NO_SPEECH_VERSION : grade.method === "ai-text" ? "gemini-3.5-flash-lite-v1" : grade.method === "text-diff" ? "text-diff-v1" : grade.method === "exact-match" ? "exact-match-v1" : "n/a";

  await pool.query(`UPDATE attempts SET response_text = $2 WHERE id = $1`, [attemptId, responseText]);
  // Only a score still waiting (or failed) is written: a grading that finished first wins.
  const updated = await pool.query(
    `UPDATE scores SET content_score = $2, manner_scores = $3, status = $4, model_version = $5, updated_at = now() WHERE attempt_id = $1 AND status IN ('pending', 'failed')`,
    [attemptId, grade.score, mannerScores ? JSON.stringify(mannerScores) : null, grade.status, modelVersion],
  );
  if (updated.rowCount && noise && !noSpeech) await recordNoisyAnswer(r.session_id, attemptId, noise).catch((err) => console.error("noisy answer record failed:", err));
}

// A typed answer whose AI grading failed: grade the saved text again.
async function gradeTypedAnswerAgain(
  attemptId: string,
  r: { response_text: string | null; item_type_id: string; answer_set: unknown; content: unknown; cefr_level: string | null; min_words: number | null },
  final: boolean,
  timeoutMs: number,
): Promise<void> {
  if (!r.response_text) return;
  const grade = await gradeAttempt(r.item_type_id, r.answer_set, r.content, r.cefr_level, r.min_words, r.response_text, timeoutMs);
  if (grade.status === "failed" && !final) throw new Error("grading: AI grading didn't answer, will retry");
  if (grade.status !== "scored") return;
  await pool.query(
    `UPDATE scores SET content_score = $2, status = 'scored', model_version = $3, updated_at = now() WHERE attempt_id = $1 AND status = 'failed'`,
    [attemptId, grade.score, grade.method === "ai-text" ? "gemini-3.5-flash-lite-v1" : grade.method === "text-diff" ? "text-diff-v1" : "exact-match-v1"],
  );
}

async function pendingSpeaking(sessionId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT a.id FROM attempts a JOIN scores sc ON sc.attempt_id = a.id JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
     WHERE a.session_id = $1 AND sc.status = 'pending' AND a.response_uri IS NOT NULL AND it.input_method = 'mic'`,
    [sessionId],
  );
  return r.rows.map((x) => x.id);
}

// At the end of a test: let the background finish the last recorded answers
// (usually seconds), then grade any still waiting here, so the result and the
// recruiter's report are complete. Never waits more than about 45 s.
export async function finishPendingSpeaking(sessionId: string): Promise<void> {
  const until = Date.now() + 20_000;
  let pending = await pendingSpeaking(sessionId);
  while (pending.length > 0 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    pending = await pendingSpeaking(sessionId);
  }
  // Answers whose grading failed during the test (a Gemini timeout) get one more try now.
  const failed = await pool.query(
    `SELECT a.id FROM attempts a JOIN scores sc ON sc.attempt_id = a.id
     WHERE a.session_id = $1 AND sc.status = 'failed' AND (a.response_uri IS NOT NULL OR coalesce(a.response_text, '') <> '')`,
    [sessionId],
  );
  const ids = [...pending, ...failed.rows.map((x) => x.id as string)];
  await Promise.all(ids.map((id) => gradeSpeakingAttempt(id, { final: true, timeoutMs: 25_000 }).catch((err) => console.error("speaking grading failed:", err))));
}

// An answer can be left ungraded or failed: a recording still waiting after
// every background try, or an AI grading that timed out. Each one gets one
// more round of background tries (once per attempt).
export async function sweepStuckSpeaking(): Promise<number> {
  const r = await pool.query(
    `SELECT a.id FROM attempts a JOIN scores sc ON sc.attempt_id = a.id JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
     WHERE a.submitted_at BETWEEN now() - interval '30 days' AND now() - interval '10 minutes'
       AND ((sc.status = 'pending' AND a.response_uri IS NOT NULL AND it.input_method = 'mic')
         OR (sc.status = 'failed' AND (a.response_uri IS NOT NULL OR coalesce(a.response_text, '') <> '')))`,
  );
  let queued = 0;
  for (const { id } of r.rows) {
    if (await enqueue("grading.speaking.retry", { attemptId: id }, { dedupeKey: `grading.speaking.retry:${id}`, maxAttempts: 3 })) queued++;
  }
  return queued;
}
