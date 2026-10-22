import { Award } from "lucide-react";
import { LearnerHero } from "@/components/learner/LearnerHero";
import { MyCertificates } from "@/components/MyCertificates";
import { tr } from "@/i18n/tr";

// The learner's certificates on their own page (also on Profile).
export function Certificates() {
  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        compact
        eyebrow={tr("Your results")}
        title={tr("Certificates")}
        subtitle={tr("Your final assessment certificates. Each has a check page anyone can open from its link or QR code.")}
        icon={Award}
      />
      <MyCertificates showEmpty />
    </div>
  );
}
