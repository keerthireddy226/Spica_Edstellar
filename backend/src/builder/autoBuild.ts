// One-click "Create the test": pick every question for the details given,
// ask the AI for what's missing (LanguageCert types), save the test, and
// finish it (and publish it, if asked) once the AI's questions are in.
import { z } from "zod";
import { pool } from "../db.js";
import { CEFR_LEVELS, type CefrLevel } from "../placement/cefr.js";
import { GENERATABLE_TYPES } from "../generation/specs.js";
import { startGenerationJob } from "../generation/pipeline.js";
import { FormError, autofill, createForm, fillSchema, publishForm, replaceItems } from "./forms.js";
import { levelTargets, testTypeLayout, type Layout } from "./layout.js";

export const createTestSchema = fillSchema.extend({
  name: z.string().trim().max(120).optional(),
  // Publish in the same click when everything is ready.
  publish: z.boolean().default(false),
});
type CreateInput = z.infer<typeof createTestSchema>;

export interface SectionSummary {
  sortOrder: number;
  label: string;
  itemTypeId: string;
  wanted: number;
  chosen: number;
  // How many of the chosen questions are from the chosen field.
  fromField: number | null;
  missing: number;
  // Questions asked of the AI for this section, and whether it can write this type.
  aiRequested: number;
  aiPossible: boolean;
}

export interface BuildSummary {
  params: Omit<CreateInput, "name" | "publish">;
  field: string | null;
  sections: SectionSummary[];
  // AI-written questions a mock can't use until a person approves them for mocks.
  needsMockApproval: string[];
  // Why the AI couldn't write some questions.
  aiErrors: string[];
  published: boolean;
  publishError: string | null;
}

const idx = (l: string | null | undefined) => CEFR_LEVELS.indexOf((l ?? "") as CefrLevel);

// The level most of a section's missing slots aim at, within the chosen range.
function levelForMissing(layout: Layout, sortOrder: number, wanted: number, have: number, min: string, max: string): string {
  const s = layout.sections.find((x) => x.sortOrder === sortOrder)!;
  const targets = levelTargets(s.levels, wanted).slice(have).filter(Boolean) as string[];
  const counts = new Map<string, number>();
  for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + 1);
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? CEFR_LEVELS[Math.round((idx(min) + idx(max)) / 2)];
  return CEFR_LEVELS[Math.max(idx(min), Math.min(idx(max), idx(mode)))];
}

function summarize(layout: Layout, r: Awaited<ReturnType<typeof autofill>>, field: string | null, aiRequested: Record<string, number>): SectionSummary[] {
  return layout.sections.map((s) => {
    const wanted = r.plan.sections.find((p) => p.sortOrder === s.sortOrder)!.count;
    const chosen = (r.chosen[String(s.sortOrder)] ?? []).length;
    return {
      sortOrder: s.sortOrder,
      label: s.label,
      itemTypeId: s.itemTypeId,
      wanted,
      chosen,
      fromField: field ? (r.fromField[String(s.sortOrder)] ?? 0) : null,
      missing: Math.max(0, wanted - chosen),
      aiRequested: aiRequested[String(s.sortOrder)] ?? 0,
      aiPossible: GENERATABLE_TYPES.includes(s.itemTypeId),
    };
  });
}

async function tryPublish(formId: string, userId: string): Promise<{ published: boolean; error: string | null }> {
  try {
    await publishForm(formId, userId);
    return { published: true, error: null };
  } catch (err) {
    return { published: false, error: err instanceof FormError ? err.code : String((err as Error).message) };
  }
}

export async function createTest(userId: string, input: CreateInput) {
  const layout = await testTypeLayout(input.testTypeId);
  if (!layout) throw new FormError("unknown_test_type");
  const levelMin = input.levelMin ?? layout.cefrMin;
  const levelMax = input.levelMax ?? layout.cefrMax;
  const field = input.domain && input.domain !== "general" ? input.domain : null;
  const r = await autofill({ ...input, levelMin, levelMax, keep: undefined });

  // Ask the AI for the gaps it can fill (a few extra, as some won't pass their checks).
  const aiRequested: Record<string, number> = {};
  const jobIds: string[] = [];
  for (const m of r.missing) {
    if (!GENERATABLE_TYPES.includes(m.itemTypeId)) continue;
    const have = (r.chosen[String(m.sortOrder)] ?? []).length;
    const wanted = have + m.count;
    const count = Math.min(50, m.count + Math.max(1, Math.ceil(m.count * 0.3)));
    const level = levelForMissing(layout, m.sortOrder, wanted, have, levelMin, levelMax);
    const j = await pool.query(
      `INSERT INTO generation_jobs (test_type_id, item_type_id, cefr_level, domain, requested, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.testTypeId, m.itemTypeId, level, field ?? "general", count, userId],
    );
    jobIds.push(j.rows[0].id);
    aiRequested[String(m.sortOrder)] = count;
  }

  const name = input.name?.trim() || `${(await pool.query(`SELECT name FROM test_types WHERE id = $1`, [input.testTypeId])).rows[0]?.name ?? "Test"} · ${input.durationMinutes} min`;
  const formId = await createForm(userId, {
    testTypeId: input.testTypeId,
    purpose: input.purpose,
    name,
    durationMinutes: input.durationMinutes,
    levelMin,
    levelMax,
    domain: input.domain ?? "general",
    sections: r.chosen,
  });
  const summary: BuildSummary = {
    params: { testTypeId: input.testTypeId, purpose: input.purpose, durationMinutes: input.durationMinutes, levelMin, levelMax, domain: input.domain, sources: input.sources },
    field,
    sections: summarize(layout, r, field, aiRequested),
    needsMockApproval: [],
    aiErrors: [],
    published: false,
    publishError: null,
  };
  const status = jobIds.length ? "waiting_for_ai" : r.missing.length ? "short" : "ready";
  if (status === "ready" && input.publish) {
    const p = await tryPublish(formId, userId);
    summary.published = p.published;
    summary.publishError = p.error;
  }
  await pool.query(`UPDATE forms SET build_status = $2, build_summary = $3, generation_job_ids = $4, publish_when_ready = $5 WHERE id = $1`, [
    formId,
    status,
    JSON.stringify(summary),
    jobIds,
    input.publish,
  ]);
  for (const id of jobIds) startGenerationJob(id);
  return { id: formId, status, summary };
}

// Tests waiting for AI questions: once every job has finished, fill the gaps
// with what passed and finish (publish, if asked and complete).
export async function continueAutoBuilds(): Promise<number> {
  const waiting = await pool.query(
    `SELECT f.id, f.created_by, f.build_summary, f.generation_job_ids, f.publish_when_ready, f.status
     FROM forms f WHERE f.build_status = 'waiting_for_ai'
       AND NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = ANY(f.generation_job_ids) AND j.status IN ('queued', 'running'))`,
  );
  let finished = 0;
  for (const f of waiting.rows) {
    const summary = f.build_summary as BuildSummary;
    if (f.status !== "draft") {
      await pool.query(`UPDATE forms SET build_status = 'ready' WHERE id = $1`, [f.id]);
      continue;
    }
    const layout = await testTypeLayout(summary.params.testTypeId);
    if (!layout) continue;
    const current = await pool.query(`SELECT item_id, sort_order FROM form_items WHERE form_id = $1 ORDER BY sort_order, position`, [f.id]);
    const keep: Record<string, string[]> = {};
    for (const r of current.rows) (keep[String(r.sort_order)] ??= []).push(r.item_id);
    const r = await autofill({ ...summary.params, keep });
    await replaceItems(f.id, layout, r.chosen);

    const jobs = (await pool.query(`SELECT id, status, error, passed, failed FROM generation_jobs WHERE id = ANY($1::uuid[])`, [f.generation_job_ids])).rows;
    const aiRequested = Object.fromEntries(summary.sections.map((s) => [String(s.sortOrder), s.aiRequested]));
    const next: BuildSummary = {
      ...summary,
      sections: summarize(layout, r, summary.field, aiRequested),
      aiErrors: jobs.filter((j) => j.status === "failed").map((j) => String(j.error ?? "").slice(0, 200)),
      needsMockApproval:
        summary.params.purpose === "mock"
          ? (
              await pool.query(`SELECT id FROM items WHERE generation_job_id = ANY($1::uuid[]) AND status = 'approved' AND NOT mock_approved`, [f.generation_job_ids])
            ).rows.map((x) => x.id as string)
          : [],
    };
    const complete = r.missing.length === 0;
    if (complete && f.publish_when_ready) {
      const p = await tryPublish(f.id, f.created_by);
      next.published = p.published;
      next.publishError = p.error;
    }
    await pool.query(`UPDATE forms SET build_status = $2, build_summary = $3, updated_at = now() WHERE id = $1`, [f.id, complete ? "ready" : "short", JSON.stringify(next)]);
    finished++;
  }
  return finished;
}
