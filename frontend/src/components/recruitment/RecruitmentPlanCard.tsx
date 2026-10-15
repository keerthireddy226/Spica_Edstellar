import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Coins } from "lucide-react";
import { getRecruitmentOverview, type RecruitmentOverview } from "@/api/recruitment";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

// The recruitment part of an organization's plan: credits and their price.
export function RecruitmentPlanCard() {
  const [o, setO] = useState<RecruitmentOverview | null>(null);
  useEffect(() => {
    getRecruitmentOverview()
      .then(setO)
      .catch(() => {});
  }, []);
  if (!o) return null;
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <span className="h-12 w-12 rounded-2xl bg-navy/15 text-navy-deep flex items-center justify-center shrink-0">
        <Coins size={24} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-display font-bold text-ink">{tr("Recruitment")}</p>
        <p className="text-sm text-muted">
          {tr("{{n}} assessment credits left. One credit = one candidate assessment, {{p}} each.", { n: o.credits, p: `$${(o.unitPriceCents / 100).toFixed(2)}` })}
        </p>
      </div>
      <Link to={`${ROUTES.ORG_ADMIN_RECRUITMENT}?tab=credits`} className="text-sm font-semibold text-navy-deep underline shrink-0">
        {tr("Get more credits")}
      </Link>
    </div>
  );
}
