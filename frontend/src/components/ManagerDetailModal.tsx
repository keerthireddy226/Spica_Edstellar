import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Layers } from "lucide-react";
import { DetailModal } from "@/components/DetailModal";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import { cardGradient } from "@/lib/cardGradients";
import { getManagerActivityDetail, type ManagerDetail, type ManagerOnboardedLearner } from "@/api/admin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function categoryLabel(category: string | null): string {
  return category === "university" ? "University" : "Organization";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// A Manager's own detail view — reachable from anywhere a Manager is shown
// (the Managers list itself, an Org Admin's activity, or nested inside an
// Admin's activity) — same component, same data, every time.
export function ManagerDetailModal({
  managerId,
  onClose,
  onBack,
  fetcher = getManagerActivityDetail,
  learnerFetcher,
}: {
  managerId: string;
  onClose: () => void;
  onBack?: () => void;
  // Lets the Org Admin console reuse this exact same view against its own
  // tenant-scoped endpoint instead of the platform-wide Admin one.
  fetcher?: (managerId: string) => Promise<{ manager: ManagerDetail; learners: ManagerOnboardedLearner[] }>;
  // Passed through to the nested LearnerProfileModal so it also hits the
  // caller's own scoped endpoint rather than the platform-wide default.
  learnerFetcher?: (learnerId: string) => Promise<import("@/api/admin").LearnerProfile>;
}) {
  const [manager, setManager] = useState<ManagerDetail | null>(null);
  const [learners, setLearners] = useState<ManagerOnboardedLearner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingLearnerId, setViewingLearnerId] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);

  // Grouped by batch so a Manager with several batches shows batches first,
  // not one long mixed list of learners.
  const batchGroups = useMemo(() => {
    if (!learners) return [];
    const groups = new Map<string, ManagerOnboardedLearner[]>();
    for (const l of learners) {
      const key = l.batchName ?? "No batch";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(l);
    }
    return [...groups.entries()].map(([batchName, batchLearners]) => ({ batchName, learners: batchLearners }));
  }, [learners]);

  useEffect(() => {
    fetcher(managerId)
      .then((res) => {
        setManager(res.manager);
        setLearners(res.learners);
      })
      .catch(() => setError("Could not load this manager's details."));
  }, [managerId, fetcher]);

  if (error) {
    return (
      <DetailModal title="Manager details" onClose={onClose} onBack={onBack}>
        <p className="text-sm text-error">{error}</p>
      </DetailModal>
    );
  }
  if (!manager || !learners) {
    return (
      <DetailModal title="Manager details" onClose={onClose} onBack={onBack}>
        <p className="text-sm text-muted">Loading…</p>
      </DetailModal>
    );
  }

  const name = [manager.firstName, manager.lastName].filter(Boolean).join(" ") || "Not named yet";
  const status = !manager.active ? "deactivated" : !manager.hasLoggedIn ? "pending" : "active";

  return (
    <DetailModal title={name} subtitle={`Manager at ${manager.tenantName}`} onClose={onClose} onBack={onBack} wide>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Manager details</p>
          <div className="border border-rule rounded-input px-4 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted">Email</p>
                <p className="text-sm text-ink">{manager.email}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Organization</p>
                <p className="text-sm text-ink">
                  {manager.tenantName} ({categoryLabel(manager.tenantCategory)})
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Batches</p>
                <p className="text-sm text-ink">{manager.batchNames.length === 0 ? "None assigned" : manager.batchNames.join(", ")}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Joined</p>
                <p className="text-sm text-ink">{formatDate(manager.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Status</p>
                <span
                  className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-pill mt-0.5 ${
                    status === "active" ? "bg-success/15 text-success" : status === "pending" ? "bg-warning/15 text-navy-deep" : "bg-error/15 text-error"
                  }`}
                >
                  {status === "active" ? "Active" : status === "pending" ? "Invite pending" : "Deactivated"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div>
          {selectedBatch === null ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Batches</p>
              {batchGroups.length === 0 ? (
                <p className="text-sm text-muted">Hasn't onboarded any learners yet.</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {batchGroups.map((g, i) => (
                    <button
                      key={g.batchName}
                      onClick={() => setSelectedBatch(g.batchName)}
                      style={cardGradient(i)}
                      className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4 text-left cursor-pointer"
                    >
                      <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
                        <Layers size={22} strokeWidth={1.8} />
                      </span>
                      <div className="min-w-0">
                        <p className="font-display font-bold text-white truncate">{g.batchName}</p>
                        <p className="text-xs text-white/80">
                          {g.learners.length} learner{g.learners.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => setSelectedBatch(null)}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink transition-colors cursor-pointer mb-2"
              >
                <ArrowLeft size={14} /> All batches
              </button>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">
                Learners in {selectedBatch}
              </p>
              <div className="flex flex-col gap-2">
                {(batchGroups.find((g) => g.batchName === selectedBatch)?.learners ?? []).map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setViewingLearnerId(l.id)}
                    className="border border-rule rounded-input px-4 py-3 flex items-center gap-3 text-left hover:border-rule-strong hover:bg-paper-warm transition-colors cursor-pointer"
                  >
                    <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                      {initials(l.firstName, l.lastName, l.email)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email}</p>
                      <p className="text-xs text-muted">{l.sessionCount} session{l.sessionCount === 1 ? "" : "s"} completed</p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill shrink-0 ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                      {l.active ? "Active" : "Deactivated"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {viewingLearnerId && (
        <LearnerProfileModal
          learnerId={viewingLearnerId}
          onClose={onClose}
          onBack={() => setViewingLearnerId(null)}
          {...(learnerFetcher ? { fetcher: learnerFetcher } : {})}
        />
      )}
    </DetailModal>
  );
}
