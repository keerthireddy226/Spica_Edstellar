import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { getMyPlan, TIER_LABELS, type PlanFeatureKey, type PlanSummary, type CatalogTier } from "@/api/plans";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/hooks/useAuth";

type MyPlan = PlanSummary & { catalog: CatalogTier[] };

// One fetch shared by every component on the page; refreshPlan() after
// anything that can change the tier (a purchase, an Admin edit).
let cached: Promise<MyPlan> | null = null;
const listeners = new Set<(p: MyPlan) => void>();

export function refreshPlan() {
  cached = getMyPlan();
  cached.then((p) => listeners.forEach((l) => l(p))).catch(() => {});
}

export function usePlan(): MyPlan | null {
  const { user } = useAuth();
  const [plan, setPlan] = useState<MyPlan | null>(null);
  useEffect(() => {
    if (!user || (user.role !== "org_admin" && user.role !== "manager")) return;
    if (!cached) cached = getMyPlan();
    let live = true;
    cached.then((p) => live && setPlan(p)).catch(() => {
      cached = null;
    });
    listeners.add(setPlan);
    return () => {
      live = false;
      listeners.delete(setPlan);
    };
  }, [user]);
  return plan;
}

// null while loading — callers treat "unknown" as allowed and let the server decide.
export function useHasFeature(feature: PlanFeatureKey): boolean | null {
  const plan = usePlan();
  if (!plan) return null;
  return plan.features.find((f) => f.key === feature)?.included ?? true;
}

// Inline explanation shown in place of a locked control.
export function PlanLockNote({ feature, compact = false }: { feature: PlanFeatureKey; compact?: boolean }) {
  const plan = usePlan();
  const { user } = useAuth();
  const info = plan?.features.find((f) => f.key === feature);
  if (!info || info.included) return null;
  const tier = TIER_LABELS[info.minTier];
  return (
    <div
      className={`flex items-start gap-2 rounded-input bg-navy/5 border border-navy/15 text-sm text-ink ${compact ? "px-3 py-2" : "px-4 py-3"}`}
    >
      <Lock size={15} className="text-navy mt-0.5 shrink-0" />
      <span>
        {info.label} {info.label.endsWith("s") ? "are" : "is"} on the {tier} plan.{" "}
        {user?.role === "org_admin" ? (
          <Link to={ROUTES.ORG_ADMIN_PLAN} className="text-navy font-semibold hover:underline">
            See plans
          </Link>
        ) : (
          <span className="text-muted">Ask your Org Admin about upgrading.</span>
        )}
      </span>
    </div>
  );
}

// "2 of 3 managers on Starter" — only shown when the plan has a cap.
export function PlanLimitHint({ limit }: { limit: "managers" | "batches" }) {
  const plan = usePlan();
  const { user } = useAuth();
  const l = plan?.limits.find((x) => x.key === limit);
  if (!plan || !l || l.max === null) return null;
  const full = l.used >= l.max;
  return (
    <p className={`text-xs ${full ? "text-error" : "text-muted"}`}>
      {l.used} of {l.max} {limit} on {plan.tierLabel}
      {full &&
        (user?.role === "org_admin" ? (
          <>
            {" · "}
            <Link to={ROUTES.ORG_ADMIN_PLAN} className="text-navy font-semibold hover:underline">
              Upgrade for unlimited
            </Link>
          </>
        ) : (
          " · ask your Org Admin about upgrading"
        ))}
    </p>
  );
}
