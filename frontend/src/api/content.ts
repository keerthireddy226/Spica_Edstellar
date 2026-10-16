import { api } from "@/lib/api";

// Staff: question generation, review and set assembly (Content review permission).

export interface ContentCheck {
  ok: boolean;
  notes?: string[];
  [k: string]: unknown;
}

export interface AssemblyPlan {
  parts: { label: string; itemTypeId: string; needed: number; available: number }[];
  complete: boolean;
  setsPossible: number;
}

export interface ContentOverview {
  testTypes: { id: string; name: string; cefrMin: string; cefrMax: string; itemTypes: string[] }[];
  itemTypeNames: Record<string, string>;
  bank: { itemTypeId: string; level: string | null; unplaced: number; unplacedMock: number; approved: number }[];
  queue: { needs_review: number; for_mock: number };
  plans: { testTypeId: string; practice: AssemblyPlan | null; mock: AssemblyPlan | null }[];
  models: { generation: string; check: string };
  ttsEnabled: boolean;
  domains: string[];
}

export interface GenerationJob {
  id: string;
  testTypeId: string;
  itemTypeId: string;
  level: string;
  domain: string;
  requested: number;
  produced: number;
  passed: number;
  failed: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ItemStats {
  n: number;
  mean: number | null;
  discrimination: number | null;
  views: number;
}

export interface ContentItem {
  id: string;
  itemTypeId: string;
  level: string | null;
  topic: string | null;
  domain: string;
  content: Record<string, unknown>;
  answerSet: Record<string, unknown> | null;
  explanation: Record<string, unknown> | null;
  status: "draft" | "approved" | "retired";
  mockApproved: boolean;
  reviewState: "needs_review" | "rejected" | null;
  reviewReason: string | null;
  reviewDecision: string | null;
  reviewNote: string | null;
  checks: Record<string, ContentCheck> | null;
  pipeline: string | null;
  placedIn: string | null;
  createdAt: string;
  stats: ItemStats | null;
  audio?: { voice: string; accent: string | null; uri: string; seconds: number }[];
}

export type QueueState = "needs_review" | "for_mock" | "approved_before_review" | "rejected";

export function getContentOverview(): Promise<ContentOverview> {
  return api("/admin/content/overview");
}

export function getGenerationJobs(): Promise<{ jobs: GenerationJob[] }> {
  return api("/admin/content/jobs");
}

export function startGeneration(body: { testTypeId: string; itemTypeId: string; level: string; domain: string; count: number }): Promise<{ id: string }> {
  return api("/admin/content/jobs", { method: "POST", body: JSON.stringify(body) });
}

export function getReviewQueue(state: QueueState, itemTypeId?: string): Promise<{ items: ContentItem[] }> {
  return api(`/admin/content/queue?state=${state}${itemTypeId ? `&itemTypeId=${encodeURIComponent(itemTypeId)}` : ""}`);
}

export function getContentItem(id: string): Promise<{ item: ContentItem }> {
  return api(`/admin/content/items/${id}`);
}

export function decideItem(
  id: string,
  body: {
    decision: "approve" | "approve_mock" | "remove_mock" | "reject";
    note?: string;
    content?: Record<string, unknown>;
    answerSet?: Record<string, unknown>;
    explanation?: Record<string, unknown> | null;
  },
) {
  return api(`/admin/content/items/${id}/decision`, { method: "POST", body: JSON.stringify(body) });
}

export function recheckItem(id: string): Promise<{ passed: boolean; checks: Record<string, ContentCheck> }> {
  return api(`/admin/content/items/${id}/recheck`, { method: "POST" });
}

export function assembleSet(testTypeId: string, mockOnly: boolean): Promise<{ examId: string; code: string; testId: string }> {
  return api("/admin/content/assemble", { method: "POST", body: JSON.stringify({ testTypeId, mockOnly }) });
}

// ---- Assessment builder: the question library and built tests (forms) ----

export type LibrarySource = "module" | "test_set" | "placement" | "ai" | "unplaced";

export interface LibraryItem {
  id: string;
  itemTypeId: string;
  typeName: string;
  family: "versant" | "languagecert";
  skills: string[];
  level: string | null;
  topic: string | null;
  domain: string;
  status: "approved" | "draft" | "retired";
  mockApproved: boolean;
  source: LibrarySource;
  // Where it sits: a set and part, or a module.
  usedIn: string | null;
  // Built tests (not retired) that use it.
  formCount: number;
  preview: string;
  answered: number;
  averageScore: number | null;
  // Time it takes in a test (answer time, recordings played twice, reading/preparation).
  seconds: number | null;
}

export interface LibraryFilters {
  family?: string;
  testTypeId?: string;
  itemTypeId?: string;
  skill?: string;
  levelMin?: string;
  levelMax?: string;
  domain?: string;
  sources?: LibrarySource[];
  status?: string;
  mockApproved?: "true" | "false";
  q?: string;
  exclude?: string[];
  ids?: string[];
  page?: number;
  pageSize?: number;
}

export function getLibrary(f: LibraryFilters): Promise<{ total: number; page: number; pageSize: number; items: LibraryItem[] }> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return api(`/admin/content/library?${p.toString()}`);
}

export function getItemUsage(id: string): Promise<{ place: string | null; source: LibrarySource; forms: { id: string; name: string; code: string; purpose: string; status: string }[] }> {
  return api(`/admin/content/items/${id}/usage`);
}

export interface BuilderTestType {
  id: string;
  name: string;
  officialMinutes: number;
  cefrMin: string;
  cefrMax: string;
  familyId: string;
  familyName: string;
}

export function getBuilderTestTypes(): Promise<{ testTypes: BuilderTestType[] }> {
  return api("/admin/content/builder/test-types");
}

export interface PlanSection {
  sortOrder: number;
  label: string;
  itemTypeId: string;
  typeName: string;
  officialCount: number;
  count: number;
  avgSeconds: number;
}

export function getBuilderPlan(testTypeId: string, durationMinutes: number): Promise<{ officialMinutes: number; cefrMin: string; cefrMax: string; plannedSeconds: number; sections: PlanSection[] }> {
  return api(`/admin/content/builder/plan?testTypeId=${encodeURIComponent(testTypeId)}&durationMinutes=${durationMinutes}`);
}

export interface FormSeconds {
  bySection: Record<string, number>;
  total: number;
}

export function autofillForm(body: {
  testTypeId: string;
  purpose: "practice" | "mock";
  durationMinutes: number;
  levelMin?: string;
  levelMax?: string;
  domain?: string;
  sources?: LibrarySource[];
  keep?: Record<string, string[]>;
}): Promise<{ sections: Record<string, string[]>; missing: { sortOrder: number; itemTypeId: string; count: number }[]; seconds: FormSeconds }> {
  return api("/admin/content/builder/autofill", { method: "POST", body: JSON.stringify(body) });
}

export function formSeconds(testTypeId: string, sections: Record<string, string[]>): Promise<FormSeconds> {
  return api("/admin/content/builder/seconds", { method: "POST", body: JSON.stringify({ testTypeId, sections }) });
}

export interface BuiltForm {
  id: string;
  testTypeId: string;
  testTypeName?: string;
  familyName?: string;
  purpose: "practice" | "mock";
  name: string;
  code: string;
  durationMinutes: number;
  shortForm: boolean;
  levelMin: string | null;
  levelMax: string | null;
  domain: string;
  status: "draft" | "published" | "retired";
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  itemCount?: number;
}

export interface FormInput {
  testTypeId: string;
  purpose: "practice" | "mock";
  name: string;
  durationMinutes: number;
  levelMin?: string;
  levelMax?: string;
  domain: string;
  sections: Record<string, string[]>;
}

export function listForms(): Promise<{ forms: BuiltForm[] }> {
  return api("/admin/content/forms");
}

export function getBuiltForm(id: string): Promise<{ form: BuiltForm; sections: Record<string, string[]>; seconds: FormSeconds }> {
  return api(`/admin/content/forms/${id}`);
}

export function createBuiltForm(body: FormInput): Promise<{ id: string }> {
  return api("/admin/content/forms", { method: "POST", body: JSON.stringify(body) });
}

export function updateBuiltForm(id: string, body: FormInput): Promise<{ ok: boolean }> {
  return api(`/admin/content/forms/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function publishBuiltForm(id: string): Promise<{ ok: boolean }> {
  return api(`/admin/content/forms/${id}/publish`, { method: "POST" });
}

export function retireBuiltForm(id: string): Promise<{ ok: boolean }> {
  return api(`/admin/content/forms/${id}/retire`, { method: "POST" });
}
