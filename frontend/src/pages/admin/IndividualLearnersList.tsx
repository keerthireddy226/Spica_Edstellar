import { useEffect, useState } from "react";
import { Users, Crown, Gift, Activity, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { getIndividualLearners, type IndividualLearnerAccount } from "@/api/admin";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function isWithinDays(iso: string, days: number): boolean {
  return Date.now() - new Date(iso).getTime() <= days * 24 * 60 * 60 * 1000;
}

function LearnersSummary({ learners }: { learners: IndividualLearnerAccount[] }) {
  const paidCount = learners.filter((l) => l.plan === "individual_paid").length;
  const freeCount = learners.filter((l) => l.plan === "individual_free").length;
  const totalSessions = learners.reduce((sum, l) => sum + l.sessionCount, 0);
  const newThisWeek = learners.filter((l) => isWithinDays(l.createdAt, 7)).length;

  const cards: { label: string; value: number; icon: LucideIcon }[] = [
    { label: "Total individual learners", value: learners.length, icon: Users },
    { label: "On a paid plan", value: paidCount, icon: Crown },
    { label: "On a free plan", value: freeCount, icon: Gift },
    { label: "Total sessions", value: totalSessions, icon: Activity },
    { label: "Signed up this week", value: newThisWeek, icon: UserPlus },
  ];

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {cards.map(({ label, value, icon: Icon }, i) => (
        <div key={label} style={cardGradient(i)} className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4">
          <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
            <Icon size={22} strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-2xl font-display font-bold text-white">{value}</p>
            <p className="text-xs text-white/80">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function IndividualLearnersList() {
  const [learners, setLearners] = useState<IndividualLearnerAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingLearnerId, setViewingLearnerId] = useState<string | null>(null);

  useEffect(() => {
    getIndividualLearners()
      .then((res) => setLearners(res.learners))
      .catch(() => setError("Could not load learners."));
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Individual Learners</h1>
        <p className="text-sm text-muted mt-1">
          Learners signed up on their own — not attached to any organization. (Showing up to 200 most recent.)
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {!learners && !error && <p className="text-sm text-muted">Loading…</p>}
      {learners?.length === 0 && <p className="text-sm text-muted">No individual learners yet.</p>}

      {learners && learners.length > 0 && (
        <>
          <LearnersSummary learners={learners} />
          <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Learner</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Sessions</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {learners.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setViewingLearnerId(l.id)}
                    className="border-b border-rule last:border-0 cursor-pointer hover:bg-paper-warm transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                          {initials(l.firstName, l.lastName, l.email)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-ink font-medium truncate">
                            {[l.firstName, l.lastName].filter(Boolean).join(" ") || "Not named yet"}
                          </p>
                          <p className="text-muted text-xs truncate">{l.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                          l.plan === "individual_paid" ? "bg-navy/10 text-navy" : "bg-paper-warm text-muted"
                        }`}
                      >
                        {l.plan === "individual_paid" ? "Paid" : "Free"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{l.sessionCount}</td>
                    <td className="px-4 py-3 text-muted">{new Date(l.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                          l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"
                        }`}
                      >
                        {l.active ? "Active" : "Deactivated"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {viewingLearnerId && <LearnerProfileModal learnerId={viewingLearnerId} onClose={() => setViewingLearnerId(null)} />}
    </div>
  );
}
