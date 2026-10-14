import type { OrgHealth } from "@/api/admin";

const STYLE: Record<OrgHealth["band"], string> = {
  healthy: "bg-success/15 text-success",
  watch: "bg-warning/20 text-navy-deep",
  at_risk: "bg-error/15 text-error",
};
const LABEL: Record<OrgHealth["band"], string> = { healthy: "Healthy", watch: "Watch", at_risk: "At risk" };

export function HealthBadge({ health }: { health: OrgHealth | null | undefined }) {
  if (!health) return <span className="text-xs text-muted">—</span>;
  return (
    <span title={health.flags.join("\n") || "No issues"} className={`text-xs font-semibold px-2 py-0.5 rounded-pill whitespace-nowrap ${STYLE[health.band]}`}>
      {health.score} · {LABEL[health.band]}
    </span>
  );
}
