import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getCandidateAssessment, type CandidateAssessment } from "@/api/recruitment";
import { tr } from "@/i18n/tr";

export function CandidateShell({ org, children }: { org?: string | null; children: ReactNode }) {
  return (
    <div className="app-surface min-h-screen flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-rule bg-surface/80">
        <span className="font-display font-bold text-ink truncate">{org ?? tr("Spica")}</span>
        <LanguageSwitcher compact />
      </header>
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-8">{children}</main>
    </div>
  );
}

export function CandidatePanel({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="w-full max-w-lg bg-surface border border-rule rounded-card shadow-sm p-6 sm:p-8 flex flex-col gap-5">
      <div className="flex flex-col items-center text-center gap-2">
        <span className="h-14 w-14 rounded-2xl bg-navy/15 text-navy-deep flex items-center justify-center">{icon}</span>
        <h1 className="font-display font-bold text-xl text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// Shown when the candidate finishes, from either test page.
export function CandidateFinished() {
  const [a, setA] = useState<CandidateAssessment | null>(null);
  useEffect(() => {
    getCandidateAssessment()
      .then(setA)
      .catch(() => {});
  }, []);
  const r = a?.result;
  return (
    <CandidateShell org={a?.organization}>
      <CandidatePanel
        icon={<CheckCircle2 size={26} />}
        title={tr("Thank you, you're done")}
        subtitle={a ? tr("Your assessment for {{job}} is complete. {{org}} will contact you about the next steps.", { job: a.jobTitle, org: a.organization }) : undefined}
      >
        {r && (
          <div className="bg-paper-warm rounded-input p-4 text-center">
            {r.cefrLevel && <p className="font-display font-bold text-3xl text-ink">{r.cefrLevel}</p>}
            {r.overallPercent !== null && r.overallPercent !== undefined && <p className="text-sm text-muted">{tr("Score: {{p}}%", { p: r.overallPercent })}</p>}
          </div>
        )}
        <p className="text-xs text-muted text-center">{tr("You can close this window.")}</p>
      </CandidatePanel>
    </CandidateShell>
  );
}

