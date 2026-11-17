// Every Gemini call is logged with its tokens and cost (table ai_calls), so the
// real cost of each plan can be measured (scripts/aiCostReport.ts). Logging
// never delays or breaks a call: it is written in the background and errors
// are ignored.
import { AsyncLocalStorage } from "node:async_hooks";
import { GoogleGenAI } from "@google/genai";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db.js";

// US$ per million tokens, from Google's Gemini API price list (checked 17 Nov
// 2026). Audio input is billed at the same rate as text for these models, and
// thinking tokens are billed as output. Longest prefix first.
const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: "gemini-3.5-flash-lite", input: 0.3, output: 2.5 },
  { prefix: "gemini-3.5-flash", input: 1.5, output: 9.0 },
  { prefix: "gemini-embedding-001", input: 0.15, output: 0 },
];

export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICES.find((x) => model.startsWith(x.prefix));
  return p ? (inputTokens * p.input + outputTokens * p.output) / 1_000_000 : null;
}

// Who a call is for. The request (and its signed-in user) comes from the
// middleware; code that knows the test session adds it with noteAiSession.
type AiContext = { purpose?: string; userId?: string; sessionId?: string; req?: Request };
const store = new AsyncLocalStorage<AiContext>();

export function aiContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  store.run({ req }, next);
}

// Runs fn with these details added (a purpose here overrides the client's own).
export function withAiContext<T>(ctx: Omit<AiContext, "req">, fn: () => T): T {
  return store.run({ ...store.getStore(), ...ctx }, fn);
}

// From here on in this async flow, AI calls belong to this test session.
export function noteAiSession(sessionId: string | null | undefined) {
  if (sessionId) store.enterWith({ ...store.getStore(), sessionId });
}

export function currentAiContext(): Omit<AiContext, "req"> & { route: string | null } {
  const ctx = store.getStore() ?? {};
  const req = ctx.req as (Request & { user?: { id: string } }) | undefined;
  return {
    purpose: ctx.purpose,
    sessionId: ctx.sessionId,
    userId: ctx.userId ?? req?.user?.id,
    route: req ? `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}` : null,
  };
}

type Usage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  promptTokensDetails?: { modality?: string; tokenCount?: number }[];
};

function record(defaultPurpose: string, model: string, usage: Usage | undefined, ms: number, ok: boolean, estimatedInput = 0) {
  const ctx = currentAiContext();
  const input = usage?.promptTokenCount ?? estimatedInput;
  const audio = usage?.promptTokensDetails?.find((d) => d.modality === "AUDIO")?.tokenCount ?? 0;
  const output = usage?.candidatesTokenCount ?? 0;
  const thinking = usage?.thoughtsTokenCount ?? 0;
  pool
    .query(
      `INSERT INTO ai_calls (model, purpose, route, user_id, session_id, input_tokens, audio_input_tokens, output_tokens, thinking_tokens, cost_usd, duration_ms, ok)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [model, ctx.purpose ?? defaultPurpose, ctx.route, ctx.userId ?? null, ctx.sessionId ?? null, input, audio, output, thinking, costUsd(model, input, output + thinking), ms, ok],
    )
    .catch(() => {});
}

// A Gemini client whose calls are logged. purpose: what this client is used for.
export function trackedGemini(purpose: string): GoogleGenAI {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const models = client.models;
  const generate = models.generateContent.bind(models);
  models.generateContent = async (params: Parameters<typeof generate>[0]) => {
    const started = Date.now();
    try {
      const res = await generate(params);
      record(purpose, params.model, res.usageMetadata, Date.now() - started, true);
      return res;
    } catch (err) {
      // A failed call is usually not billed; it is kept to count failures.
      record(purpose, params.model, undefined, Date.now() - started, false);
      throw err;
    }
  };
  const embedContent = models.embedContent.bind(models);
  models.embedContent = async (params: Parameters<typeof embedContent>[0]) => {
    const started = Date.now();
    // Embedding answers carry no token count: about 4 characters a token.
    const contents = params.contents;
    const chars = Array.isArray(contents) ? contents.reduce((n: number, c) => n + (typeof c === "string" ? c.length : 0), 0) : typeof contents === "string" ? contents.length : 0;
    try {
      const res = await embedContent(params);
      record("embedding", params.model, undefined, Date.now() - started, true, Math.ceil(chars / 4));
      return res;
    } catch (err) {
      record("embedding", params.model, undefined, Date.now() - started, false);
      throw err;
    }
  };
  return client;
}
