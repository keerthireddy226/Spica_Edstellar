// Voice consistency, run after a proctored test. Spoken answers are joined
// into stretches of at least CHUNK_SECONDS of speech, and the stretches are
// compared with each other and with the voice sample read at the start.
//
// Thresholds come from the voice lab recordings (3 speakers, 6 speaking
// styles, 3 takes each), joined to about 16 s of speech per stretch: the same
// speaker scored 0.838 or higher, different speakers 0.732 or lower. A single
// 4 s clip overlapped badly (about 11% equal error rate), which is why the
// old pre-test check failed. Three speakers is a small sample: recalibrate
// with more voices and keep the uncertain band between the two cut-offs.
import path from "node:path";
import { pool } from "../db.js";
import { concat, cosine, decodeAudio, embed, trimSilence, voiceModelAvailable } from "./voice.js";
import { mediaPath } from "./storage.js";

export const CHUNK_SECONDS = 15;
export const SAME_SPEAKER = 0.8;
export const DIFFERENT_SPEAKER = 0.74;
// The start-of-test sample needs this much speech to be used.
export const BASELINE_MIN_SECONDS = 10;
const MAX_CHUNKS = 6;

export type VoiceDecision = "match" | "uncertain" | "mismatch" | "insufficient_audio" | "error";

export async function speechSeconds(file: string): Promise<number> {
  return trimSilence(await decodeAudio(file)).stats.speechSeconds;
}

export async function runVoiceCheck(sessionId: string): Promise<VoiceDecision | null> {
  const s = (
    await pool.query(
      `SELECT si.user_id, si.session_type, si.policy, si.biometric_opt_out FROM session_integrity si WHERE si.session_id = $1`,
      [sessionId],
    )
  ).rows[0];
  if (!s || !s.policy?.voiceMatch || s.biometric_opt_out) return null;
  const purpose = s.session_type === "placement" ? "placement" : "practice_test";
  const save = async (decision: VoiceDecision, score: number | null, detail: Record<string, unknown>) => {
    await pool.query(`DELETE FROM voice_check_results WHERE session_id = $1 AND method = 'session_consistency'`, [sessionId]);
    await pool.query(
      `INSERT INTO voice_check_results (user_id, session_id, purpose, decision, similarity_score, flagged_for_review, method, detail)
       VALUES ($1, $2, $3, $4, $5, $6, 'session_consistency', $7)`,
      [s.user_id, sessionId, purpose, decision, score, decision === "mismatch" || decision === "uncertain", JSON.stringify(detail)],
    );
    return decision;
  };
  if (!voiceModelAvailable()) return save("error", null, { reason: "voice_model_missing" });

  const answers = await pool.query(
    `SELECT id, response_uri FROM attempts WHERE session_id = $1 AND response_uri IS NOT NULL ORDER BY created_at`,
    [sessionId],
  );
  const pieces: { attemptId: string; speech: Float32Array }[] = [];
  for (const a of answers.rows) {
    if (!String(a.response_uri).startsWith("/uploads/")) continue;
    try {
      const { speech } = trimSilence(await decodeAudio(path.join(process.cwd(), a.response_uri)));
      if (speech.length) pieces.push({ attemptId: a.id, speech });
    } catch {
      // An unreadable recording is skipped; the rest still count.
    }
  }

  // Greedy stretches of CHUNK_SECONDS; a short tail joins the last stretch.
  const chunks: { attemptIds: string[]; speech: Float32Array[]; seconds: number }[] = [];
  let cur: (typeof chunks)[number] = { attemptIds: [], speech: [], seconds: 0 };
  for (const p of pieces) {
    cur.attemptIds.push(p.attemptId);
    cur.speech.push(p.speech);
    cur.seconds += p.speech.length / 16000;
    if (cur.seconds >= CHUNK_SECONDS) {
      chunks.push(cur);
      cur = { attemptIds: [], speech: [], seconds: 0 };
    }
  }
  if (cur.seconds > 0) {
    if (chunks.length && cur.seconds < CHUNK_SECONDS) {
      const last = chunks[chunks.length - 1];
      last.attemptIds.push(...cur.attemptIds);
      last.speech.push(...cur.speech);
      last.seconds += cur.seconds;
    } else if (cur.seconds >= CHUNK_SECONDS) chunks.push(cur);
  }
  // Too many stretches only repeats work; merge neighbours down to MAX_CHUNKS.
  while (chunks.length > MAX_CHUNKS) {
    const [a, b] = chunks.splice(chunks.length - 2, 2);
    chunks.push({ attemptIds: [...a.attemptIds, ...b.attemptIds], speech: [...a.speech, ...b.speech], seconds: a.seconds + b.seconds });
  }

  let baseline: Float32Array | null = null;
  let baselineSeconds = 0;
  const base = (
    await pool.query(`SELECT uri FROM proctoring_media WHERE session_id = $1 AND kind = 'voice_baseline' AND uri IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [
      sessionId,
    ])
  ).rows[0];
  const baseFile = base ? mediaPath(base.uri) : null;
  if (baseFile) {
    try {
      const { speech, stats } = trimSilence(await decodeAudio(baseFile));
      baselineSeconds = stats.speechSeconds;
      if (stats.speechSeconds >= BASELINE_MIN_SECONDS) baseline = embed(speech);
    } catch {
      baseline = null;
    }
  }

  const totalSeconds = Math.round(pieces.reduce((n, p) => n + p.speech.length / 16000, 0));
  const detailBase = { totalSpeechSeconds: totalSeconds, answers: pieces.length, baselineSeconds: Math.round(baselineSeconds), thresholds: { same: SAME_SPEAKER, different: DIFFERENT_SPEAKER, chunkSeconds: CHUNK_SECONDS } };
  // One stretch alone has nothing to compare with unless there's a baseline.
  if (chunks.length === 0 || (chunks.length === 1 && !baseline)) return save("insufficient_audio", null, detailBase);

  const vectors = chunks.map((c) => embed(concat(c.speech)));
  const pairs: { a: number; b: number; score: number }[] = [];
  for (let i = 0; i < vectors.length; i++) for (let j = i + 1; j < vectors.length; j++) pairs.push({ a: i, b: j, score: cosine(vectors[i], vectors[j]) });
  const vsBaseline = baseline ? vectors.map((v) => cosine(v, baseline!)) : null;
  const all = [...pairs.map((p) => p.score), ...(vsBaseline ?? [])];
  const lowest = Math.min(...all);
  const decision: VoiceDecision = lowest >= SAME_SPEAKER ? "match" : lowest < DIFFERENT_SPEAKER ? "mismatch" : "uncertain";

  const round = (n: number) => Math.round(n * 1000) / 1000;
  return save(decision, round(lowest), {
    ...detailBase,
    chunks: chunks.map((c, i) => ({ attemptIds: c.attemptIds, seconds: Math.round(c.seconds), vsBaseline: vsBaseline ? round(vsBaseline[i]) : null })),
    pairs: pairs.map((p) => ({ ...p, score: round(p.score) })),
  });
}
