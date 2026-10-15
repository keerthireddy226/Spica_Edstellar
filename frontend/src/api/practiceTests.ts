import { api } from "@/lib/api";
import type { TestItem } from "@/api/testSession";

export interface ExamProduct {
  id: string;
  setCount: number;
}

export interface ExamSummary {
  id: string;
  code: string;
  name: string;
  itemCount: number;
  completed: boolean;
}

export interface PartBoundary {
  partId: string;
  label: string;
  startIndex: number;
  count: number;
}

export interface ExamCompleteResult {
  // This attempt's Test ID, e.g. "FS-7K3M-9QX2".
  testCode?: string | null;
  gradedCount: number;
  correctCount: number;
  pendingCount: number;
  skippedCount: number;
  failedCount: number;
  overallPercent: number;
  partResults: { label: string; gradedCount: number; correctCount: number }[];
  // CEFR level from the levels of the questions answered; null until something is scored.
  cefrLevel?: string | null;
  skillLevels?: Partial<Record<"listening" | "speaking" | "reading" | "writing", string>> | null;
  skillPercents?: Partial<Record<"listening" | "speaking" | "reading" | "writing", number>> | null;
}

export function getProducts(): Promise<{ products: ExamProduct[] }> {
  return api("/practice-tests/products");
}

export function getExamsForProduct(product: string): Promise<{ exams: ExamSummary[] }> {
  return api(`/practice-tests/${encodeURIComponent(product)}/exams`);
}

export function startExamSession(
  examId: string,
): Promise<{ sessionId: string; testCode: string | null; examId: string; partBoundaries: PartBoundary[]; items: TestItem[] }> {
  return api("/practice-tests/session", { method: "POST", body: JSON.stringify({ examId }) });
}

export function getExamSession(
  sessionId: string,
): Promise<{ sessionId: string; testCode: string | null; examId: string; completed: boolean; partBoundaries: PartBoundary[]; items: TestItem[] }> {
  return api(`/practice-tests/session/${sessionId}`);
}

export function submitExamAttempt(
  sessionId: string,
  payload: { itemId: string; responseText?: string; audioBase64?: string; audioMimeType?: string; durationMs?: number; activeMs?: number },
) {
  return api(`/practice-tests/session/${sessionId}/attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function completeExamSession(sessionId: string): Promise<ExamCompleteResult> {
  return api(`/practice-tests/session/${sessionId}/complete`, { method: "POST" });
}
