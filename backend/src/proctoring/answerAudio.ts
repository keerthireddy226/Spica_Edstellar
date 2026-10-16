// Background noise in a recorded answer, measured on the server. It's review
// evidence and feedback for the learner; it never changes the grade.
import { pool } from "../db.js";
import { analyzeSession } from "./analyze.js";
import { decodeAudio, trimSilence } from "./voice.js";

// Signal-to-noise of the recording, in dB (loud frames against quiet ones).
// Clean answers measured 17-59 dB (97 real answers, median 23); speech mixed
// with pink noise at about 9 dB measured 10-15, at about 15 dB 14-20. Under
// 12 the noise is loud enough to cover words.
export const NOISY_SNR_DB = 12;

export interface AnswerNoise {
  snrDb: number | null;
  noisy: boolean;
}

// A recording quieter than this overall is near silence, not noise.
const SILENT_DBFS = -45;

export async function measureAnswerNoise(file: string): Promise<AnswerNoise> {
  let samples: Float32Array;
  try {
    samples = await decodeAudio(file);
  } catch {
    return { snrDb: null, noisy: false };
  }
  const { stats } = trimSilence(samples);
  if (stats.speechSeconds >= 1) return { snrDb: stats.snrDb, noisy: stats.snrDb < NOISY_SNR_DB };
  // No stretch stands out as speech: either near silence, or noise so steady
  // and loud that it covers the speech.
  let sum = 0;
  for (const v of samples) sum += v * v;
  const dbfs = samples.length ? 10 * Math.log10(Math.max(sum / samples.length, 1e-12)) : -120;
  return dbfs > SILENT_DBFS && stats.snrDb < NOISY_SNR_DB ? { snrDb: stats.snrDb, noisy: true } : { snrDb: null, noisy: false };
}

// Adds a noisy answer to the test's integrity timeline when the test's policy
// listens to the microphone (the learner agreed to it). No risk points: noise
// isn't misconduct, but the reviewer and the learner should know.
export async function recordNoisyAnswer(sessionId: string, attemptId: string, noise: AnswerNoise): Promise<void> {
  if (!noise.noisy) return;
  const si = (
    await pool.query(
      `SELECT si.user_id, si.policy, s.completed_at FROM session_integrity si JOIN sessions s ON s.id = si.session_id WHERE si.session_id = $1`,
      [sessionId],
    )
  ).rows[0];
  if (!si?.policy?.audioMonitoring) return;
  await pool.query(`INSERT INTO proctoring_events (session_id, user_id, type, severity, detail) VALUES ($1, $2, 'noisy_answer', 'info', $3)`, [
    sessionId,
    si.user_id,
    JSON.stringify({ attemptId, reason: `Background noise: ${noise.snrDb} dB signal-to-noise` }),
  ]);
  // Graded after the test finished (background grading): list it on the result too.
  if (si.completed_at) await analyzeSession(sessionId);
}
