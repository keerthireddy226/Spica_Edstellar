import { FileText } from "lucide-react";
import { DPA_URL, PRIVACY_NOTICE_URL, type PrivacyAudience } from "@/constants/routes";
import { useAuth } from "@/hooks/useAuth";

// /privacy: the Privacy Notices, one for each kind of user, with the one that
// applies to the signed-in person first. The notices themselves are static
// pages (public/legal), shared with the documents for legal review.
const NOTICES: { audience: PrivacyAudience; title: string; who: string }[] = [
  { audience: "free", title: "Individual users: free account", who: "You signed up yourself and use Spica's free features." },
  { audience: "paid", title: "Individual users: paid plan", who: "You signed up yourself and bought a plan or practice tests." },
  { audience: "organization", title: "Organization and university users", who: "Your employer, university or school gave you access to Spica." },
  { audience: "assessment", title: "Assessment-only users", who: "You take only an English assessment: from a recruiter's or admissions office's link, or one you bought on its own." },
];

export function PrivacyNotice() {
  const { user } = useAuth();
  const mine = user?.privacyAudience;
  const ordered = mine ? [...NOTICES.filter((n) => n.audience === mine), ...NOTICES.filter((n) => n.audience !== mine)] : NOTICES;
  return (
    <div className="min-h-screen bg-paper-warm px-4 py-10">
      <div className="mx-auto max-w-2xl bg-surface border border-rule rounded-card shadow-sm p-6 md:p-10 flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Spica by Edstellar</p>
          <h1 className="font-display font-bold text-2xl text-ink">Privacy Notices</h1>
          <p className="text-sm text-muted">How Spica uses personal data depends on how you use it. Open the notice that fits you.</p>
        </header>
        <div className="flex flex-col gap-3">
          {ordered.map((n) => (
            <a
              key={n.audience}
              href={PRIVACY_NOTICE_URL[n.audience]}
              className={`rounded-card border p-4 flex items-start gap-3 hover:border-navy ${n.audience === mine ? "border-navy bg-navy/5" : "border-rule"}`}
            >
              <FileText size={20} className="text-navy-deep shrink-0 mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-ink">
                  {n.title}
                  {n.audience === mine && <span className="ml-2 text-xs font-semibold text-navy-deep">Applies to you</span>}
                </span>
                <span className="text-sm text-muted">{n.who}</span>
              </span>
            </a>
          ))}
        </div>
        <p className="text-sm text-muted border-t border-rule pt-4">
          For organizations and universities: the{" "}
          <a href={DPA_URL} className="underline">
            Data Processing Agreement
          </a>
          . Questions: contact the Spica Super Admin.
        </p>
      </div>
    </div>
  );
}
