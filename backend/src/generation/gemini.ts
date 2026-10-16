// Gemini calls for the question pipeline: a stronger model writes questions
// (decision D6), a different, cheaper one checks them, and embeddings find
// near-duplicates.
import { GoogleGenAI } from "@google/genai";

// The design asks for a stronger model to write questions. Pro models need
// a paid Gemini plan (the free tier allows none), so the default is the
// strongest Flash that runs on this key; set GEMINI_GENERATION_MODEL (e.g.
// gemini-pro-latest) once billing is on.
export const GENERATION_MODEL = process.env.GEMINI_GENERATION_MODEL || "gemini-3.5-flash";
export const CHECK_MODEL = process.env.GEMINI_CHECK_MODEL || "gemini-3.5-flash-lite";
const EMBEDDING_MODEL = "gemini-embedding-001";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

// Gemini answers 503 when a model is busy and 429 at a rate limit; both
// usually pass within seconds. A daily quota (a retry hint of hours) doesn't.
function retryDelayMs(err: unknown, attempt: number): number | null {
  const e = err as { status?: number; message?: string };
  const status = e.status ?? Number(/"code":\s*(\d{3})/.exec(String(e.message))?.[1]);
  if (status !== 503 && status !== 429 && status !== 500) return null;
  const hint = /retry in (\d+(?:\.\d+)?)s/i.exec(String(e.message));
  if (hint && Number(hint[1]) > 60) return null;
  return hint ? Number(hint[1]) * 1000 + 500 : [5_000, 15_000, 40_000][attempt] ?? null;
}

export async function withRetries<T>(f: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await f();
    } catch (err) {
      const wait = attempt < attempts - 1 ? retryDelayMs(err, attempt) : null;
      if (wait === null) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function generateJson<T>(opts: {
  model: string;
  prompt: string;
  schema: Record<string, unknown>;
  temperature: number;
  timeoutMs?: number;
}): Promise<{ data: T; usage: Usage }> {
  const response = await withRetries(() => Promise.race([
    getClient().models.generateContent({
      model: opts.model,
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      config: { responseMimeType: "application/json", responseJsonSchema: opts.schema, temperature: opts.temperature },
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${opts.model}: timed out`)), opts.timeoutMs ?? 180_000)),
  ]));
  const meta = response.usageMetadata;
  return {
    data: JSON.parse(response.text ?? "") as T,
    usage: { inputTokens: meta?.promptTokenCount ?? 0, outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0) },
  };
}

// One vector per text (batches of up to 100).
export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const r = await withRetries(() => getClient().models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts.slice(i, i + 100),
      config: { taskType: "SEMANTIC_SIMILARITY", outputDimensionality: 768 },
    }));
    for (const e of r.embeddings ?? []) out.push(e.values ?? []);
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
