import { api } from "@/lib/api";

export interface FlaggedCheck {
  decision: string;
  similarityScore: number | null;
  sampleUri: string | null;
  createdAt: string;
}

export interface PendingPlacement {
  id: string;
  user_id: string;
  email: string;
  name?: string | null;
  org_name?: string | null;
  taken_at: string;
  overall_percent: string;
  cefr_level: string;
  flagged_checks: FlaggedCheck[];
}

export function getPendingReviewPlacements(): Promise<{ placements: PendingPlacement[] }> {
  return api("/placement/admin/pending-review");
}

export function reviewPlacement(id: string, verdict: "certified" | "fraud_confirmed", note?: string): Promise<{ status: string }> {
  return api(`/placement/admin/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ verdict, note }),
  });
}

export interface ReviewHistoryRow {
  id: string;
  email: string;
  name: string | null;
  org_name: string | null;
  status: "certified" | "fraud_confirmed";
  cefr_level: string;
  overall_percent: string;
  taken_at: string;
  reviewed_at: string;
  review_note: string | null;
  reviewer: string | null;
}

export function getReviewHistory(): Promise<{
  stats: { pending: number; decidedThisMonth: number; fraud: number; cleared: number; placements: number; avgHoursToDecide: number };
  history: ReviewHistoryRow[];
}> {
  return api("/placement/admin/review-history");
}
