import { useEffect, useState } from "react";
import { commercialApi, type OrgHealth } from "@/api/admin";
import { HealthBadge } from "@/components/HealthBadge";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
// Organizations whose health is slipping, worst first.
export function AtRiskOrganizations() {
  const [orgs, setOrgs] = useState<(OrgHealth & { id: string; name: string })[] | null>(null);
  useEffect(() => {
    commercialApi
      .health()
      .then((r) => setOrgs(r.organizations.filter((o) => o.band !== "healthy").slice(0, 8)))
      .catch(() => setOrgs([]));
  }, []);
  if (!orgs) return null;
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <h2 className="font-display font-bold text-lg text-ink">{tr("Organizations needing attention")}</h2>
      {orgs.length === 0 ? (
        <p className="text-sm text-muted">{tr("Every organization looks healthy.")}</p>
      ) : (
        orgs.map((o) => (
          <div key={o.id} className="flex items-start justify-between gap-3 border-t border-rule pt-2.5 first:border-0 first:pt-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink truncate">{o.name}</p>
              <p className="text-xs text-muted">{o.flags.slice(0, 3).map((f) => trServer(f)).join(" · ") || tr("Low activity")}</p>
            </div>
            <HealthBadge health={o} />
          </div>
        ))
      )}
    </div>
  );
}
