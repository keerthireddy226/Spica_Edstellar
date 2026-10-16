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
