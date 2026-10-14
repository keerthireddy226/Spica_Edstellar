import { useEffect, useMemo, useState } from "react";
import { Layers, UserRound, Users } from "lucide-react";
import { Badge, Pill, DetailModal, InfoGrid, ModalEmpty, ModalRow, ModalSection, personInitials } from "@/components/DetailModal";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import { getManagerActivityDetail, type ManagerDetail, type ManagerOnboardedLearner } from "@/api/admin";


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
  const sessions = learners.reduce((n, l) => n + l.sessionCount, 0);
  const activeLearners = learners.filter((l) => l.active).length;
  const shown = selectedBatch ? (batchGroups.find((g) => g.batchName === selectedBatch)?.learners ?? []) : learners;

  return (
    <DetailModal
      title={name}
      subtitle={`${manager.email} · Manager at ${manager.tenantName}`}
      initials={personInitials(manager.firstName, manager.lastName, manager.email)}
      badges={
        <>
          <Badge tone={status === "active" ? "good" : status === "pending" ? "warn" : "bad"}>
            {status === "active" ? "Active" : status === "pending" ? "Invite pending" : "Deactivated"}
          </Badge>
          <Badge>{categoryLabel(manager.tenantCategory)}</Badge>
          <Badge>Joined {formatDate(manager.createdAt)}</Badge>
        </>
      }
      stats={[
        { label: "Batches", value: manager.batchNames.length },
        { label: "Learners", value: learners.length, hint: `${activeLearners} active` },
        { label: "Sessions completed", value: sessions },
        { label: "Avg sessions per learner", value: learners.length ? (sessions / learners.length).toFixed(1) : "—" },
      ]}
      onClose={onClose}
      onBack={onBack}
      wide
    >
      <div className="flex flex-col gap-6">
        <ModalSection title="Details" icon={UserRound}>
          <InfoGrid
            items={[
              ["Email", manager.email],
              ["Organization", `${manager.tenantName} (${categoryLabel(manager.tenantCategory)})`],
              ["Batches", manager.batchNames.length === 0 ? "None assigned" : manager.batchNames.join(", ")],
              ["Joined", formatDate(manager.createdAt)],
            ]}
          />
        </ModalSection>

        <ModalSection title="Batches" icon={Layers}>
          {batchGroups.length === 0 ? (
            <ModalEmpty icon={Layers}>No learners in their batches yet.</ModalEmpty>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedBatch(null)}
                className={`px-3.5 py-1.5 rounded-pill text-sm font-semibold border transition-colors cursor-pointer ${selectedBatch === null ? "bg-navy text-white border-navy" : "border-rule text-ink hover:bg-paper-warm"}`}
              >
                All · {learners.length}
              </button>
              {batchGroups.map((g) => (
                <button
                  key={g.batchName}
                  onClick={() => setSelectedBatch(g.batchName)}
                  className={`px-3.5 py-1.5 rounded-pill text-sm font-semibold border transition-colors cursor-pointer ${selectedBatch === g.batchName ? "bg-navy text-white border-navy" : "border-rule text-ink hover:bg-paper-warm"}`}
                >
                  {g.batchName} · {g.learners.length}
                </button>
              ))}
            </div>
          )}
        </ModalSection>

        {learners.length > 0 && (
          <ModalSection title={selectedBatch ? `Learners in ${selectedBatch}` : "Learners"} icon={Users}>
            <div className="grid md:grid-cols-2 gap-2">
              {shown.map((l) => (
                <ModalRow
                  key={l.id}
                  initials={personInitials(l.firstName, l.lastName, l.email)}
                  title={[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email}
                  subtitle={`${l.batchName ?? "No batch"} · ${l.sessionCount} session${l.sessionCount === 1 ? "" : "s"} completed`}
                  right={<Pill tone={l.active ? "good" : "bad"}>{l.active ? "Active" : "Deactivated"}</Pill>}
                  onClick={() => setViewingLearnerId(l.id)}
                />
              ))}
            </div>
          </ModalSection>
        )}
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
