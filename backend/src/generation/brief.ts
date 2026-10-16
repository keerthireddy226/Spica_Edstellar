// The brief the generator gets: the question type, the CEFR level, the field,
// diversity rules, and a few approved questions of the same type as a guide
// to style (never to copy).
import { pool } from "../db.js";
import { SPECS, type Json } from "./specs.js";

// What learners at each level can handle, for the questions' language.
export const CEFR_DESCRIPTORS: Record<string, string> = {
  A1: "A1: very common everyday words; present simple, can/can't, there is; short sentences of 5-10 words; concrete topics (family, shopping, times, places). Speech is slow and clear.",
  A2: "A2: everyday vocabulary; past simple, going to, comparatives; sentences of up to about 15 words; routine topics (work, travel, plans, services). Speech is clear, at a moderate pace.",
  B1: "B1: wider everyday and work vocabulary; present perfect, conditionals, modal verbs; linked sentences; opinions and reasons on familiar topics. Natural pace, clear speech.",
  B2: "B2: broad vocabulary including some abstract and work-specific words; complex sentences, passives, reported speech; arguments, advantages and disadvantages. Natural pace, some informal language.",
  C1: "C1: precise and idiomatic vocabulary; complex structures used flexibly; implied meaning, attitude and tone matter; abstract and professional topics. Fast natural speech.",
  C2: "C2: very wide vocabulary including nuance and idiom; dense, sophisticated texts; subtle implication and stance. Native-speaker pace and style.",
};

export const DOMAIN_CONTEXT: Record<string, string> = {
  general: "everyday life, study, work and travel",
  banking: "banking: opening accounts, KYC and ID checks, cards and payments, loans and EMIs, branch and phone-banking conversations, fraud alerts",
  bpo: "customer support and BPO: calls and chats with customers, complaints, refunds, order tracking, shift handovers, service-level targets",
  it: "IT and software: team stand-ups, tickets and bug reports, deployments, client requirements, remote collaboration, security reminders",
  insurance: "insurance: policies, premiums, claims, coverage questions, renewals and customer calls",
  healthcare: "healthcare workplaces: appointments, reception, patient information leaflets, staff rotas (no medical advice)",
};

export const DIVERSITY_RULES = `Rules for every question:
- Original content only. Never copy or closely paraphrase published exam material or the examples below.
- Vary names and places across regions (India, the UK, the US, Nigeria, Kenya, South Africa, the Philippines, China, Japan, Brazil, Germany, Australia and more); vary genders and ages. No stereotypes.
- No real brands, companies, celebrities or politicians. No medical, legal, financial or political advice. Nothing upsetting (violence, disasters, illness details).
- British, American and other standard spellings are all fine; keep one spelling style within a question.
- Spread the correct option across positions 0, 1 and 2.
- Wrong options must be clearly wrong for someone who understood, but not silly.`;

async function styleExamples(itemTypeId: string, level: string): Promise<Json[]> {
  const r = await pool.query(
    `SELECT content, answer_set FROM items WHERE item_type_id = $1 AND status = 'approved'
     ORDER BY (cefr_level = $2) DESC, random() LIMIT 2`,
    [itemTypeId, level],
  );
  return r.rows.map((x) => ({ content: x.content, answer_set: x.answer_set }));
}

// Topics already used for this type and level, so the generator picks others.
async function usedTopics(itemTypeId: string, level: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT topic, count(*) FROM items WHERE item_type_id = $1 AND cefr_level = $2 AND topic IS NOT NULL AND status <> 'retired'
     GROUP BY topic ORDER BY count(*) DESC LIMIT 40`,
    [itemTypeId, level],
  );
  return r.rows.map((x) => x.topic as string);
}

export async function buildBrief(args: { itemTypeId: string; level: string; domain: string; count: number; testTypeName: string }): Promise<string> {
  const spec = SPECS[args.itemTypeId];
  const examples = await styleExamples(args.itemTypeId, args.level);
  const topics = await usedTopics(args.itemTypeId, args.level);
  return `You write original questions for ${args.testTypeName}-style English practice tests (Spica, a learning app; not affiliated with any exam publisher).

Write ${args.count} different questions of this type:
${spec.brief}

Level: ${CEFR_DESCRIPTORS[args.level]}
Every text, recording script, question and option must be at this level. Recording scripts are spoken aloud by text-to-speech: write them as natural speech, with no stage directions or sound effects.
Field: ${DOMAIN_CONTEXT[args.domain] ?? DOMAIN_CONTEXT.general}.

${DIVERSITY_RULES}

Each question needs a different topic.${topics.length ? ` Avoid these topics, already used at this level: ${topics.join(", ")}.` : ""}
${
  spec.key === "free"
    ? ""
    : "For each question, give the answer key and an explanation: why the right option is right, the exact words that give the answer, and for every option why it is right or wrong."
}

Approved questions of this type, as a guide to format and style only:
${examples.map((e) => JSON.stringify(e)).join("\n")}`;
}
