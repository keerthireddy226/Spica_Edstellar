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
