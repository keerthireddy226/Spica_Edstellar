import { useEffect, useState } from "react";
import { getReadiness, type Readiness } from "@/api/assessment";

// The learner's final assessment, predicted level and certificate, fetched
// once per page load and shared by the cards and the path that show it.
let cache: Promise<Readiness | null> | null = null;

export function useReadiness(): Readiness | null {
  const [r, setR] = useState<Readiness | null>(null);
  useEffect(() => {
    cache ??= getReadiness().catch(() => null);
    cache.then(setR);
    // A later page load fetches it again.
    return () => {
      setTimeout(() => (cache = null), 0);
    };
  }, []);
  return r;
}
