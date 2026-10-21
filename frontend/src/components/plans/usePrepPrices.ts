import { useEffect, useState } from "react";
import { formatAmount, getPriceList } from "@/api/payments";

// For a test that isn't in the learner's plan: the price to prepare for it
// (Preparation + real test + certificate), when the learner buys for themselves.
let cache: Promise<{ canBuy: boolean; prep: Record<string, string> }> | null = null;

export function usePrepPrices() {
  const [v, setV] = useState<{ canBuy: boolean; prep: Record<string, string> } | null>(null);
  useEffect(() => {
    cache ??= getPriceList()
      .then((r) => ({
        canBuy: r.canBuy,
        prep: Object.fromEntries(r.products.filter((p) => p.kind === "prep" && p.testTypeId).map((p) => [p.testTypeId!, formatAmount(p.amount, p.currency)])),
      }))
      .catch(() => ({ canBuy: false, prep: {} }));
    cache.then(setV);
  }, []);
  return v;
}
