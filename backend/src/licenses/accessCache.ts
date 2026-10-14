import { TtlCache } from "../lib/ttlCache.js";
import type { LearnerAccess } from "./service.js";

// Every practice/test write checks access; caching the answer for a minute
// saves two queries per request. License changes clear the user's entry
// (invalidateAccess), so the only staleness is an expiry crossing within
// that minute or a change made on another API instance.
export const accessCache = new TtlCache<{ kind: "org" | "individual" | "other"; access: LearnerAccess | null }>(60_000);

export function invalidateAccess(userId: string) {
  accessCache.delete(userId);
}
