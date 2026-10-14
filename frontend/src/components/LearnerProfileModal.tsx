import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { countryName } from "@/constants/demographics";
import { DetailModal } from "@/components/DetailModal";
import { getLearnerProfile, type LearnerProfile } from "@/api/admin";
import { EditLearnerDetailsModal } from "@/components/EditLearnerDetailsModal";
import type { LearnerDetails } from "@/api/details";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Label sits outside the bordered box, flush with every other section
// heading in this modal (boxed or not) so they all line up on one left edge.
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</p>
        {action}
      </div>
      <div className="border border-rule rounded-input px-4 py-3">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm text-ink">{value}</p>
    </div>
  );
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  practice: "Practice",
  mocktest: "Mock Test",
  placement: "Placement",
  coach: "Coach Mode",
  diagnostic: "Diagnostic",
  drill: "Drill",
};

// Every learner row anywhere in the Super Admin console — Individual
// Learners, a Manager's activity list, an Org Admin's/Admin's learner
// tables — opens this same full detail view: onboarding answers, placement
// result, roadmap, progress, and activity, not just a row of summary stats.
export function LearnerProfileModal({
  learnerId,
  onClose,
  onBack,
  fetcher = getLearnerProfile,
  saveDetails,
}: {
  learnerId: string;
  onClose: () => void;
  onBack?: () => void;
  // Lets the Org Admin console reuse this exact same view against its own
  // tenant-scoped endpoint instead of the platform-wide Admin one.
  fetcher?: (learnerId: string) => Promise<LearnerProfile>;
  // Org Admin and Manager: lets them edit the learner's employee details.
  saveDetails?: (learnerId: string, d: LearnerDetails) => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    fetcher(learnerId)
      .then(setProfile)
      .catch(() => setError("Could not load this learner's details."));
  }, [learnerId, fetcher, reload]);

  if (error) {
    return (
      <DetailModal title="Learner details" onClose={onClose} onBack={onBack}>
        <p className="text-sm text-error">{error}</p>
      </DetailModal>
    );
  }
  if (!profile) {
    return (
      <DetailModal title="Learner details" onClose={onClose} onBack={onBack}>
        <p className="text-sm text-muted">Loading…</p>
      </DetailModal>
    );
  }

  const { learner, onboarding, placement, roadmap, progress, skillStats, activity, employment } = profile;
  const name = [learner.firstName, learner.lastName].filter(Boolean).join(" ") || "Not named yet";

  return (
    <DetailModal
      title={name}
      subtitle={`${learner.participantId ? `${learner.participantId} · ` : ""}${learner.email} · ${learner.tenantName ?? "Individual"}${learner.batchName ? ` · ${learner.batchName}` : ""}`}
      onClose={onClose}
      onBack={onBack}
      wide
    >
      <div className="flex flex-col gap-4">
        <Section title="Account">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <Field label="Participant ID" value={learner.participantId ?? "—"} />
            <Field label="Joined" value={formatDate(learner.createdAt)} />
            <Field label="Plan / org type" value={learner.tenantCategory ?? learner.tenantType ?? "—"} />
            <Field label="Status" value={learner.active ? "Active" : "Deactivated"} />
          </div>
        </Section>

        {employment ? (
          <Section
            title="Employee details"
            action={
              saveDetails && (
                <button onClick={() => setEditing(true)} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
                  Edit details
                </button>
              )
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label="Employee ID" value={employment.employeeId ?? "—"} />
              <Field label="Department" value={employment.department ?? "—"} />
              <Field label="Job title" value={employment.jobTitle ?? "—"} />
              <Field label="Job role" value={employment.jobRole ? t(`demographics.jobRole.${employment.jobRole}`) : "—"} />
              <Field label="Work phone" value={employment.phone ?? "—"} />
              <Field label="Country" value={countryName(employment.country, i18n.language)} />
              <Field label="City" value={employment.city ?? "—"} />
              <Field label="Gender" value={employment.gender ? t(`demographics.gender.${employment.gender}`) : "Not shared"} />
              <Field label="Age" value={employment.ageBand ? t(`demographics.ageBand.${employment.ageBand}`) : "Not shared"} />
            </div>
            {employment.demographicsSource && (
              <p className="text-xs text-muted mt-3">
                {employment.demographicsSource === "organization"
                  ? "Location, gender and age were entered by the organization; the learner can change them when they sign in."
                  : "Location, gender and age were given by the learner."}
              </p>
            )}
          </Section>
        ) : (
          <Section title="About">
            {!onboarding ? (
              <p className="text-sm text-muted">Hasn't completed onboarding yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <Field label="Country" value={countryName(onboarding.country, i18n.language)} />
                <Field label="City" value={onboarding.city ?? "—"} />
                <Field label="Job role" value={onboarding.jobRole ? t(`demographics.jobRole.${onboarding.jobRole}`) : "—"} />
                <Field label="Gender" value={onboarding.gender ? t(`demographics.gender.${onboarding.gender}`) : "Not shared"} />
                <Field label="Age" value={onboarding.ageBand ? t(`demographics.ageBand.${onboarding.ageBand}`) : "Not shared"} />
              </div>
            )}
          </Section>
        )}

        <Section title="Onboarding questionnaire">
          {!onboarding ? (
            <p className="text-sm text-muted">Hasn't completed onboarding yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label="Exam" value={onboarding.examPreference ?? "—"} />
              <Field label="Goal level" value={onboarding.goalLevel ?? "—"} />
              <Field label="Score target" value={onboarding.scoreTarget ?? "—"} />
              <Field label="Reason" value={onboarding.examReason ?? "—"} />
              <Field label="Exam date" value={formatDate(onboarding.examDate)} />
              <Field label="Prep days" value={onboarding.targetPrepDays ?? "—"} />
              <Field label="Daily minutes goal" value={onboarding.dailyMinutesPreference ?? "—"} />
              <Field label="Past attempts" value={onboarding.pastAttemptsStatus ?? "—"} />
              {onboarding.pastAttemptsStatus && onboarding.pastAttemptsStatus !== "first" && (
                <Field label="Previous score" value={onboarding.prevScore ? `${onboarding.prevScore} (${onboarding.prevDate ?? "date unknown"})` : "—"} />
              )}
            </div>
          )}
        </Section>

        <Section title="Placement result">
          {!placement ? (
            <p className="text-sm text-muted">Hasn't taken a placement test yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label="CEFR level" value={placement.cefrLevel} />
              <Field label="Overall score" value={`${placement.overallPercent}%`} />
              <Field label="Status" value={placement.status} />
              <Field label="Taken" value={formatDate(placement.takenAt)} />
            </div>
          )}
        </Section>

        <Section title="Roadmap">
          {!roadmap ? (
            <p className="text-sm text-muted">No roadmap generated yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label="Pace" value={roadmap.pace} />
              <Field label="Minutes / day" value={roadmap.minutesPerDay} />
              <Field label="Est. total hours" value={roadmap.totalHoursEstimate} />
              <Field label="Generated" value={formatDate(roadmap.generatedAt)} />
            </div>
          )}
        </Section>

        <Section title="Progress">
          {!progress ? (
            <p className="text-sm text-muted">No practice activity yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label="Sessions" value={progress.sessionsCount} />
              <Field label="Questions completed" value={progress.questionsCompleted} />
              <Field label="Practice minutes" value={progress.practiceMinutes} />
              <Field label="Streak" value={`${progress.streakDays} days`} />
              <Field label="XP" value={progress.totalXp} />
              <Field
                label="Accuracy"
                value={progress.accuracyGraded > 0 ? `${Math.round((progress.accuracyCorrect / progress.accuracyGraded) * 100)}%` : "—"}
              />
            </div>
          )}
          {skillStats.length > 0 && (
            <div className="mt-3 pt-3 border-t border-rule grid grid-cols-2 sm:grid-cols-4 gap-3">
              {skillStats.map((s) => (
                <Field
                  key={s.skill}
                  label={s.skill[0].toUpperCase() + s.skill.slice(1)}
                  value={s.accuracyGraded > 0 ? `${Math.round((s.accuracyCorrect / s.accuracyGraded) * 100)}%` : "—"}
                />
              ))}
            </div>
          )}
        </Section>

        {profile.batchHistory && profile.batchHistory.length > 0 && (
          <Section title="Batch history">
            <div className="flex flex-col gap-2">
              {profile.batchHistory.map((m, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">
                    {m.fromBatch ?? "No batch"} → {m.toBatch ?? "No batch"}
                    {m.reason ? <span className="text-muted"> · {m.reason}</span> : null}
                  </span>
                  <span className="text-xs text-muted shrink-0">
                    {m.movedBy ? `${m.movedBy} · ` : ""}
                    {formatDate(m.movedAt)}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Activity across the platform">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-3">
            <Field label="Total sessions started" value={activity.totalSessions} />
            <Field label="Genuinely completed" value={activity.genuinelyCompletedSessions} />
            <Field label="Last session" value={formatDate(activity.lastSessionAt)} />
          </div>
          {activity.sessionsByType.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-rule">
              {activity.sessionsByType.map((s) => (
                <span key={s.type} className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-navy/10 text-navy">
                  {SESSION_TYPE_LABEL[s.type] ?? s.type}: {s.count}
                </span>
              ))}
            </div>
          )}
        </Section>
      </div>
      {editing && employment && saveDetails && (
        <EditLearnerDetailsModal
          name={name}
          initial={employment}
          save={(d) => saveDetails(learner.id, d)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setReload((n) => n + 1);
          }}
        />
      )}
    </DetailModal>
  );
}
