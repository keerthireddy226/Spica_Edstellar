import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { countryName } from "@/constants/demographics";
import { Badge, DetailModal, personInitials } from "@/components/DetailModal";
import { getLearnerProfile, type LearnerProfile } from "@/api/admin";
import { EditLearnerDetailsModal } from "@/components/EditLearnerDetailsModal";
import type { LearnerDetails } from "@/api/details";

import { tr } from "@/i18n/tr";
import { dateTime } from "@/api/staff";
import { trServer } from "@/i18n/serverText";
import { LearnerIntegritySection } from "@/components/proctoring/LearnerIntegritySection";
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
        <p className="text-sm font-display font-bold text-ink flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-navy" />
          {title}
        </p>
        {action}
      </div>
      <div className="bg-surface border border-rule rounded-card shadow-sm px-5 py-4">{children}</div>
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
  practice: tr("Practice"),
  mocktest: tr("Mock Test"),
  placement: tr("Placement"),
  coach: tr("Coach Mode"),
  diagnostic: tr("Diagnostic"),
  drill: tr("Drill"),
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
      .catch(() => setError(tr("Could not load this learner's details.")));
  }, [learnerId, fetcher, reload]);

  if (error) {
    return (
      <DetailModal title={tr("Learner details")} onClose={onClose} onBack={onBack}>
        <p className="text-sm text-error">{error}</p>
      </DetailModal>
    );
  }
  if (!profile) {
    return (
      <DetailModal title={tr("Learner details")} onClose={onClose} onBack={onBack}>
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      </DetailModal>
    );
  }

  const { learner, onboarding, placement, roadmap, progress, skillStats, activity, employment } = profile;
  const name = [learner.firstName, learner.lastName].filter(Boolean).join(" ") || tr("Not named yet");

  return (
    <DetailModal
      title={name}
      subtitle={`${learner.participantId ? `${learner.participantId} · ` : ""}${learner.email}`}
      initials={personInitials(learner.firstName, learner.lastName, learner.email)}
      badges={
        <>
          <Badge tone={learner.active ? "good" : "bad"}>{learner.active ? tr("Active") : tr("Deactivated")}</Badge>
          <Badge>{learner.tenantType === "cohort" ? (learner.tenantName ?? tr("Organization")) : tr("Individual learner")}</Badge>
          {learner.batchName && <Badge>{learner.batchName}</Badge>}
          {employment?.department && <Badge>{employment.department}</Badge>}
        </>
      }
      stats={[
        { label: tr("Current level"), value: placement?.cefrLevel ?? "Not placed", hint: placement ? tr("{{overallPercent}}% on placement", { overallPercent: placement.overallPercent }) : undefined },
        { label: tr("Sessions completed"), value: activity.genuinelyCompletedSessions, hint: `${activity.totalSessions} started` },
        { label: tr("Day streak"), value: progress?.streakDays ?? 0, hint: progress ? tr("{{practiceMinutes}} minutes practised", { practiceMinutes: progress.practiceMinutes }) : undefined },
        {
          label: tr("Accuracy"),
          value: progress && progress.accuracyGraded > 0 ? `${Math.round((progress.accuracyCorrect / progress.accuracyGraded) * 100)}%` : "—",
          hint: activity.lastSessionAt ? tr("Last session {{formatDate}}", { formatDate: dateTime(activity.lastSessionAt) }) : tr("No sessions yet"),
        },
      ]}
      onClose={onClose}
      onBack={onBack}
      wide
    >
      <div className="flex flex-col gap-4">
        <Section title={tr("Account")}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <Field label={tr("Participant ID")} value={learner.participantId ?? "—"} />
            <Field label={tr("Joined")} value={dateTime(learner.createdAt)} />
            <Field label={tr("Plan / org type")} value={learner.tenantCategory ?? learner.tenantType ?? "—"} />
            <Field label={tr("Status")} value={learner.active ? tr("Active") : tr("Deactivated")} />
          </div>
        </Section>

        {employment ? (
          <Section
            title={tr("Employee details")}
            action={
              saveDetails && (
                <button onClick={() => setEditing(true)} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
                  {tr("Edit details")}</button>
              )
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label={tr("Employee ID")} value={employment.employeeId ?? "—"} />
              <Field label={tr("Department")} value={employment.department ?? "—"} />
              <Field label={tr("Job title")} value={employment.jobTitle ?? "—"} />
              <Field label={tr("Job role")} value={employment.jobRole ? t(`demographics.jobRole.${employment.jobRole}`) : "—"} />
              <Field label={tr("Work phone")} value={employment.phone ?? "—"} />
              <Field label={tr("Country")} value={countryName(employment.country, i18n.language)} />
              <Field label={tr("City")} value={employment.city ?? "—"} />
              <Field label={tr("Gender")} value={employment.gender ? t(`demographics.gender.${employment.gender}`) : tr("Not shared")} />
              <Field label={tr("Age")} value={employment.ageBand ? t(`demographics.ageBand.${employment.ageBand}`) : tr("Not shared")} />
            </div>
            {employment.demographicsSource && (
              <p className="text-xs text-muted mt-3">
                {employment.demographicsSource === "organization"
                  ? tr("Location, gender and age were entered by the organization; the learner can change them when they sign in.")
                  : tr("Location, gender and age were given by the learner.")}
              </p>
            )}
          </Section>
        ) : (
          <Section title={tr("About")}>
            {!onboarding ? (
              <p className="text-sm text-muted">{tr("Hasn't completed onboarding yet.")}</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <Field label={tr("Country")} value={countryName(onboarding.country, i18n.language)} />
                <Field label={tr("City")} value={onboarding.city ?? "—"} />
                <Field label={tr("Job role")} value={onboarding.jobRole ? t(`demographics.jobRole.${onboarding.jobRole}`) : "—"} />
                <Field label={tr("Gender")} value={onboarding.gender ? t(`demographics.gender.${onboarding.gender}`) : tr("Not shared")} />
                <Field label={tr("Age")} value={onboarding.ageBand ? t(`demographics.ageBand.${onboarding.ageBand}`) : tr("Not shared")} />
              </div>
            )}
          </Section>
        )}

        <Section title={tr("Onboarding questionnaire")}>
          {!onboarding ? (
            <p className="text-sm text-muted">{tr("Hasn't completed onboarding yet.")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label={tr("Exam")} value={onboarding.examPreference ?? "—"} />
              <Field label={tr("Goal level")} value={onboarding.goalLevel ?? "—"} />
              <Field label={tr("Score target")} value={onboarding.scoreTarget ?? "—"} />
              <Field label={tr("Reason")} value={onboarding.examReason ?? "—"} />
              <Field label={tr("Exam date")} value={formatDate(onboarding.examDate)} />
              <Field label={tr("Prep days")} value={onboarding.targetPrepDays ?? "—"} />
              <Field label={tr("Daily minutes goal")} value={onboarding.dailyMinutesPreference ?? "—"} />
              <Field label={tr("Past attempts")} value={onboarding.pastAttemptsStatus ?? "—"} />
              {onboarding.pastAttemptsStatus && onboarding.pastAttemptsStatus !== "first" && (
                <Field label={tr("Previous score")} value={onboarding.prevScore ? `${onboarding.prevScore} (${onboarding.prevDate ?? tr("date unknown")})` : "—"} />
              )}
            </div>
          )}
        </Section>

        <Section title={tr("Placement result")}>
          {!placement ? (
            <p className="text-sm text-muted">{tr("Hasn't taken a placement test yet.")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label={tr("CEFR level")} value={placement.cefrLevel} />
              <Field label={tr("Overall score")} value={`${placement.overallPercent}%`} />
              <Field label={tr("Status")} value={placement.status} />
              <Field label={tr("Taken")} value={dateTime(placement.takenAt)} />
            </div>
          )}
        </Section>

        <Section title={tr("Roadmap")}>
          {!roadmap ? (
            <p className="text-sm text-muted">{tr("No roadmap generated yet.")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label={tr("Pace")} value={roadmap.pace} />
              <Field label={tr("Minutes / day")} value={roadmap.minutesPerDay} />
              <Field label={tr("Est. total hours")} value={roadmap.totalHoursEstimate} />
              <Field label={tr("Generated")} value={dateTime(roadmap.generatedAt)} />
            </div>
          )}
        </Section>

        <LearnerIntegritySection learnerId={learner.id} Section={Section} />

        <Section title={tr("Progress")}>
          {!progress ? (
            <p className="text-sm text-muted">{tr("No practice activity yet.")}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Field label={tr("Sessions")} value={progress.sessionsCount} />
              <Field label={tr("Questions completed")} value={progress.questionsCompleted} />
              <Field label={tr("Practice minutes")} value={progress.practiceMinutes} />
              <Field label={tr("Streak")} value={`${progress.streakDays} days`} />
              <Field label={tr("XP")} value={progress.totalXp} />
              <Field
                label={tr("Accuracy")}
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
          <Section title={tr("Batch history")}>
            <div className="flex flex-col gap-2">
              {profile.batchHistory.map((m, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">
                    {m.fromBatch ?? tr("No batch")} → {m.toBatch ?? tr("No batch")}
                    {m.reason ? <span className="text-muted"> · {trServer(m.reason)}</span> : null}
                  </span>
                  <span className="text-xs text-muted shrink-0">
                    {m.movedBy ? `${m.movedBy} · ` : ""}
                    {dateTime(m.movedAt)}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title={tr("Activity across the platform")}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-3">
            <Field label={tr("Total sessions started")} value={activity.totalSessions} />
            <Field label={tr("Genuinely completed")} value={activity.genuinelyCompletedSessions} />
            <Field label={tr("Last session")} value={dateTime(activity.lastSessionAt)} />
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
