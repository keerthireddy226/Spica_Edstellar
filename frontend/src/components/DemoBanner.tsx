import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Award, Sparkles } from "lucide-react";
import { getMyAccess, type DemoState } from "@/api/access";
import { tr } from "@/i18n/tr";

// Channel Partner demo learners (stage 3): what the 7-day demo includes and
// what's left, and a "talk to us" note once it has ended.
export function DemoBanner() {
  const [d, setD] = useState<{ demo: DemoState | null; ended: boolean } | null>(null);
  const onReport = /report/i.test(useLocation().pathname);
  useEffect(() => {
    getMyAccess()
      .then((a) => setD({ demo: a.demo ?? null, ended: !!a.demoEnded && !a.full && !a.owned.length }))
      .catch(() => setD(null));
  }, []);
  if (!d || (!d.demo && !d.ended)) return null;
  if (!d.demo)
    return (
      <div className="mb-4 rounded-card border border-navy/30 bg-navy/10 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
        <Sparkles size={16} className="text-navy shrink-0" />
        <b>{tr("Your 7-day demo has ended.")}</b>
        {onReport && <b className="text-error">{tr("Demo · not an official result")}</b>}
        <span>{tr("Your reports stay here. Talk to your organisation or Spica about full access and an official certificate.")}</span>
      </div>
    );
  const x = d.demo;
  const days = Math.max(0, Math.ceil((new Date(x.endsAt).getTime() - Date.now()) / 86400000));
  return (
    <div className="mb-4 rounded-card border border-warning/50 bg-warning/15 px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="flex items-center gap-1.5 font-bold">
        <Sparkles size={16} /> {tr("Demo · {{n}} days left", { n: days })}
      </span>
      {onReport && <span className="font-bold text-error">{tr("Demo · not an official result")}</span>}
      <span>{tr("English 4 Skills Essentials: Practice Modules, practice tests {{p}} of 2 left, mock test {{m}} of 1 left.", { p: x.practiceLeft, m: x.mocksLeft })}</span>
      {x.mocksLeft > 0 && !x.mockUnlocked && <span className="text-muted">{tr("The mock test opens after you finish a practice test.")}</span>}
      <Link to="/certificate/SAMPLE" target="_blank" className="flex items-center gap-1 font-semibold text-navy">
        <Award size={14} /> {tr("No certificate in the demo: see the sample")}
      </Link>
    </div>
  );
}
