import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import {
  getOnboardingProfile,
  submitOnboarding,
  type AccessDuration,
  type AttemptsStatus,
  type ExamPreference,
  type ExamReason,
  type GoalLevel,
  type OnboardingAnswers,
  type JobRole,
  type Gender,
  type AgeBand,
} from "@/api/onboarding";
import { AGE_BANDS, GENDERS, JOB_ROLES, sortedCountries } from "@/constants/demographics";
import { Button } from "@/components/Button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ROUTES } from "@/constants/routes";
import { getRoadmap } from "@/api/roadmap";

/* Shared step chrome + small controls, local to this page */

const TOTAL_STEPS = 7;

function WizardShell({
  stepIndex,
  children,
  onNext,
  onBack,
  nextDisabled,
  nextLabel,
}: {
  stepIndex: number;
  children: React.ReactNode;
  onNext?: () => void;
  onBack?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="app-surface min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex-1 flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full ${i <= stepIndex ? "bg-navy" : "bg-rule"}`} />
            ))}
          </div>
          <span className="text-xs text-muted whitespace-nowrap">
            {t("onboarding.wizard.stepLabel", { current: stepIndex + 1, total: TOTAL_STEPS })}
          </span>
        </div>
        <div className="bg-surface border border-rule rounded-card p-8 flex flex-col gap-6">{children}</div>
        <div className="flex items-center justify-between px-1">
          {onBack ? (
            <button type="button" onClick={onBack} className="text-sm font-medium text-muted hover:text-ink">
              {t("onboarding.wizard.back")}
            </button>
          ) : (
            <span />
          )}
          {onNext && (
            <Button onClick={onNext} disabled={nextDisabled}>
              {nextLabel ?? t("onboarding.wizard.next")}
            </Button>
          )}
        </div>
        <LanguageSwitcher />
      </div>
    </div>
  );
}

function OptionGrid<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string; desc: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          className={`text-left rounded-input border p-3.5 transition-colors ${
            selected === opt.value ? "border-navy bg-paper-warm" : "border-rule hover:border-rule-strong"
          }`}
        >
          <div className="text-sm font-semibold text-ink">{opt.label}</div>
          <div className="text-xs text-muted mt-0.5">{opt.desc}</div>
        </button>
      ))}
    </div>
  );
}

function RadioGroup<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((opt) => (
        <label
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={`flex items-center gap-2.5 rounded-input border px-3.5 py-2.5 text-sm cursor-pointer transition-colors ${
            selected === opt.value ? "border-navy bg-paper-warm" : "border-rule hover:border-rule-strong"
          }`}
        >
          <input type="radio" checked={selected === opt.value} readOnly className="accent-navy" />
          <span className="text-ink">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <label className="block text-sm font-medium text-ink mb-1.5">{children}</label>;
}

const textInputClass =
  "w-full rounded-input border border-rule bg-paper px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy";

/* Wizard state */

// Choices start unset (null) — a preselected option would look like a choice the learner never made.
type FormState = Omit<
  OnboardingAnswers,
  | "consentGiven"
  | "examPreference"
  | "goalLevel"
  | "examReason"
  | "hasAppliedForExam"
  | "targetPrepDays"
  | "pastAttemptsStatus"
  | "dailyMinutesPreference"
  | "accessDuration"
> & {
  consentGiven: boolean;
  examPreference: ExamPreference | null;
  goalLevel: GoalLevel | null;
  examReason: ExamReason | null;
  hasAppliedForExam: boolean | null;
  targetPrepDays: number | null;
  pastAttemptsStatus: AttemptsStatus | null;
  dailyMinutesPreference: number | null;
  accessDuration: AccessDuration | null;
  country: string;
  city: string;
  jobRole: JobRole | null;
  gender: Gender | null;
  ageBand: AgeBand | null;
  demographicsConsent: boolean;
};

function emptyForm(): FormState {
  return {
    firstName: "",
    lastName: "",
    examPreference: null,
    goalLevel: null,
    scoreTarget: "",
    examReason: null,
    hasAppliedForExam: null,
    examDate: null,
    targetPrepDays: null,
    pastAttemptsStatus: null,
    prevScore: "",
    prevDate: "",
    dailyMinutesPreference: null,
    accessDuration: null,
    consentGiven: false,
    country: "",
    city: "",
    jobRole: null,
    gender: null,
    ageBand: null,
    demographicsConsent: false,
  };
}

export function Onboarding() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [checkingProfile, setCheckingProfile] = useState(true);

  // A learner who already finished onboarding lands here again on every
  // fresh login (LANDING_ROUTE_BY_ROLE always points here first) — bounce
  // them onward instead of making them redo the wizard. If they've also
  // already completed the placement test, skip straight to the roadmap
  // instead of the placement instructions screen, so logging back in never
  // means retaking the test.
  useEffect(() => {
    let cancelled = false;
    getOnboardingProfile()
      .then((profile) => {
        if (cancelled) return;
        if (profile?.onboarding_complete) {
          getRoadmap()
            .then(() => {
              if (!cancelled) navigate(ROUTES.ROADMAP, { replace: true });
            })
            .catch(() => {
              if (!cancelled) navigate(ROUTES.PLACEMENT, { replace: true });
            });
        } else {
          setCheckingProfile(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCheckingProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // `user` loads asynchronously (a /me fetch on mount), so it's usually still
  // null on first render — this fills in the name once it arrives, without
  // clobbering anything the learner has already typed.
  useEffect(() => {
    if (!user) return;
    setForm((prev) => ({
      ...prev,
      firstName: prev.firstName || user.firstName || "",
      lastName: prev.lastName || user.lastName || "",
    }));
  }, [user]);

  function patch(fields: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...fields }));
  }

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  async function handleFinish() {
    // Unreachable via the UI — each step's "Next" stays disabled until its
    // fields are chosen — but narrows the nullable draft fields to the
    // non-null shape submitOnboarding expects.
    if (
      form.examPreference === null ||
      form.goalLevel === null ||
      form.examReason === null ||
      form.hasAppliedForExam === null ||
      form.targetPrepDays === null ||
      form.pastAttemptsStatus === null ||
      form.dailyMinutesPreference === null ||
      form.accessDuration === null ||
      form.jobRole === null
    ) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // The guard above already confirmed every nullable field is filled in —
      // TS just can't carry that narrowing through a spread, so this cast
      // stands in for re-listing all 8 fields individually.
      await submitOnboarding({
        ...(form as OnboardingAnswers),
        consentGiven: true,
        country: form.country,
        city: form.city.trim(),
        jobRole: form.jobRole,
        gender: form.gender,
        ageBand: form.ageBand,
        demographicsConsent: form.demographicsConsent,
      });
      navigate(ROUTES.PLACEMENT, { replace: true });
    } catch {
      setError(t("onboarding.wizard.consent.error"));
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingProfile) return null;

  if (step === 0) {
    const invalid = !form.firstName.trim() || !form.lastName.trim();
    return (
      <WizardShell stepIndex={0} onNext={next} nextDisabled={invalid}>
        <div>
          <h2 className="font-display font-bold text-xl text-ink">{t("onboarding.wizard.basics.title")}</h2>
          <p className="text-sm text-muted mt-1">{t("onboarding.wizard.basics.subtitle")}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>{t("onboarding.wizard.basics.firstNameLabel")}</FieldLabel>
            <input
              className={textInputClass}
              value={form.firstName}
              onChange={(e) => patch({ firstName: e.target.value })}
              placeholder={t("onboarding.wizard.basics.firstNamePlaceholder")}
            />
          </div>
          <div>
            <FieldLabel>{t("onboarding.wizard.basics.lastNameLabel")}</FieldLabel>
            <input
              className={textInputClass}
              value={form.lastName}
              onChange={(e) => patch({ lastName: e.target.value })}
              placeholder={t("onboarding.wizard.basics.lastNamePlaceholder")}
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>{t("onboarding.wizard.basics.emailLabel")}</FieldLabel>
            <input className={`${textInputClass} opacity-60 cursor-not-allowed`} value={user?.email ?? ""} disabled />
            <p className="text-xs text-muted mt-1">{t("onboarding.wizard.basics.emailNote")}</p>
          </div>
        </div>
      </WizardShell>
    );
  }

  if (step === 1) {
    const needsConsent = form.gender !== null || form.ageBand !== null;
    const invalid =
      !form.country || !form.city.trim() || form.jobRole === null || (needsConsent && !form.demographicsConsent);
    const selectClass = `${textInputClass} cursor-pointer`;
    return (
      <WizardShell stepIndex={1} onNext={next} onBack={back} nextDisabled={invalid}>
        <div>
          <h2 className="font-display font-bold text-xl text-ink">{t("onboarding.wizard.about.title")}</h2>
          <p className="text-sm text-muted mt-1">{t("onboarding.wizard.about.subtitle")}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>{t("onboarding.wizard.about.countryLabel")}</FieldLabel>
            <select className={selectClass} value={form.country} onChange={(e) => patch({ country: e.target.value })}>
              <option value="">{t("onboarding.wizard.about.select")}</option>
              {sortedCountries(i18n.language).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>{t("onboarding.wizard.about.cityLabel")}</FieldLabel>
            <input
              className={textInputClass}
              value={form.city}
              onChange={(e) => patch({ city: e.target.value })}
              placeholder={t("onboarding.wizard.about.cityPlaceholder")}
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>{t("onboarding.wizard.about.jobRoleLabel")}</FieldLabel>
            <select
              className={selectClass}
              value={form.jobRole ?? ""}
              onChange={(e) => patch({ jobRole: (e.target.value || null) as JobRole | null })}
            >
              <option value="">{t("onboarding.wizard.about.select")}</option>
              {JOB_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`demographics.jobRole.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>{t("onboarding.wizard.about.genderLabel")}</FieldLabel>
            <select
              className={selectClass}
              value={form.gender ?? ""}
              onChange={(e) => patch({ gender: (e.target.value || null) as Gender | null })}
            >
              <option value="">{t("onboarding.wizard.about.skip")}</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {t(`demographics.gender.${g}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>{t("onboarding.wizard.about.ageLabel")}</FieldLabel>
            <select
              className={selectClass}
              value={form.ageBand ?? ""}
              onChange={(e) => patch({ ageBand: (e.target.value || null) as AgeBand | null })}
            >
              <option value="">{t("onboarding.wizard.about.skip")}</option>
              {AGE_BANDS.map((a) => (
                <option key={a} value={a}>
                  {t(`demographics.ageBand.${a}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {needsConsent && (
          <label className="flex items-start gap-2.5 rounded-input border border-rule p-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.demographicsConsent}
              onChange={(e) => patch({ demographicsConsent: e.target.checked })}
              className="mt-0.5 accent-navy"
            />
            <span className="text-sm text-ink">{t("onboarding.wizard.about.consent")}</span>
          </label>
        )}
        <p className="text-xs text-muted">{t("onboarding.wizard.about.privacyNote")}</p>
      </WizardShell>
    );
  }

  if (step === 2) {
    const examOptions = (
      ["versant", "ielts", "toefl", "pte", "cambridge", "other"] as const
    ).map((value) => ({
      value,
      label: t(`onboarding.wizard.examGoal.exam.${value}`),
      desc: t(`onboarding.wizard.examGoal.exam.${value}Desc`),
    }));
    const goalOptions = (["A1", "A2", "B1", "B2", "C1", "C2", "unsure"] as const).map((value) => ({
      value,
      label: t(`onboarding.wizard.examGoal.goal.${value}`),
      desc: t(`onboarding.wizard.examGoal.goal.${value}Desc`),
    }));
    const invalid = form.examPreference === null || form.goalLevel === null;
    return (
      <WizardShell stepIndex={2} onNext={next} onBack={back} nextDisabled={invalid}>
        <div>
          <h2 className="font-display font-bold text-xl text-ink">{t("onboarding.wizard.examGoal.examTitle")}</h2>
          <p className="text-sm text-muted mt-1 mb-3">{t("onboarding.wizard.examGoal.examSubtitle")}</p>
          <OptionGrid options={examOptions} selected={form.examPreference} onSelect={(v) => patch({ examPreference: v })} />
        </div>
        <div className="pt-2 border-t border-rule">
          <h3 className="font-display font-bold text-lg text-ink mt-4">{t("onboarding.wizard.examGoal.goalTitle")}</h3>
          <p className="text-sm text-muted mt-1 mb-3">{t("onboarding.wizard.examGoal.goalSubtitle")}</p>
          <OptionGrid options={goalOptions} selected={form.goalLevel} onSelect={(v) => patch({ goalLevel: v })} />
          <div className="mt-4">
            <FieldLabel>{t("onboarding.wizard.examGoal.scoreTargetLabel")}</FieldLabel>
            <input
              className={textInputClass}
              value={form.scoreTarget}
              onChange={(e) => patch({ scoreTarget: e.target.value })}
              placeholder={t("onboarding.wizard.examGoal.scoreTargetPlaceholder")}
            />
          </div>
        </div>
      </WizardShell>
    );
  }

  if (step === 3) {
    const reasonOptions = (["university", "job", "immigration", "promotion", "personal"] as const).map((value) => ({
      value,
      label: t(`onboarding.wizard.reasonTimeline.reason.${value}`),
    }));
    const invalid =
      form.examReason === null ||
      form.hasAppliedForExam === null ||
      (form.hasAppliedForExam && !form.examDate) ||
      form.targetPrepDays === null ||
      form.targetPrepDays <= 0;
    return (
      <WizardShell stepIndex={3} onNext={next} onBack={back} nextDisabled={invalid}>
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <h2 className="font-display font-bold text-xl text-ink">{t("onboarding.wizard.reasonTimeline.reasonTitle")}</h2>
            <p className="text-sm text-muted mt-1 mb-3">{t("onboarding.wizard.reasonTimeline.reasonSubtitle")}</p>
            <RadioGroup options={reasonOptions} selected={form.examReason} onSelect={(v) => patch({ examReason: v })} />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-ink">{t("onboarding.wizard.reasonTimeline.appliedTitle")}</h2>
            <p className="text-sm text-muted mt-1 mb-3">{t("onboarding.wizard.reasonTimeline.appliedSubtitle")}</p>
            <RadioGroup
              options={[
                { value: "yes" as const, label: t("onboarding.wizard.reasonTimeline.appliedYes") },
                { value: "no" as const, label: t("onboarding.wizard.reasonTimeline.appliedNo") },
              ]}
              selected={form.hasAppliedForExam === null ? null : form.hasAppliedForExam ? "yes" : "no"}
              onSelect={(v) => patch({ hasAppliedForExam: v === "yes" })}
            />
            {form.hasAppliedForExam && (
              <div className="mt-3">
                <FieldLabel>{t("onboarding.wizard.reasonTimeline.examDateLabel")}</FieldLabel>
                <input
                  type="date"
                  className={textInputClass}
                  value={form.examDate ?? ""}
                  onChange={(e) => patch({ examDate: e.target.value })}
                />
              </div>
            )}
            <div className="mt-3">
              <FieldLabel>{t("onboarding.wizard.reasonTimeline.prepDaysLabel")}</FieldLabel>
              <div className="flex items-center gap-2.5">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.targetPrepDays ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    patch({ targetPrepDays: raw === "" ? null : Number(raw) });
                  }}
                  placeholder={t("onboarding.wizard.reasonTimeline.prepDaysPlaceholder")}
                  className={`${textInputClass} w-28 text-center font-semibold`}
                />
                <span className="text-sm text-muted">{t("onboarding.wizard.reasonTimeline.days")}</span>
              </div>
            </div>
          </div>
        </div>
      </WizardShell>
    );
  }

  if (step === 4) {
    const attemptsOptions = (["first", "once", "multiple"] as const).map((value) => ({
      value,
      label: t(`onboarding.wizard.attemptsCommitment.attempts.${value}`),
    }));
    const timeOptions = (["min15", "min30", "min60", "min90"] as const).map((key) => ({
      value: Number(key.replace("min", "")),
      label: t(`onboarding.wizard.attemptsCommitment.time.${key}`),
      desc: t(`onboarding.wizard.attemptsCommitment.time.${key}Desc`),
    }));
    const invalid = form.pastAttemptsStatus === null || form.dailyMinutesPreference === null;
    return (
      <WizardShell stepIndex={4} onNext={next} onBack={back} nextDisabled={invalid}>
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <h2 className="font-display font-bold text-xl text-ink">
              {t("onboarding.wizard.attemptsCommitment.attemptsTitle")}
            </h2>
            <p className="text-sm text-muted mt-1 mb-3">{t("onboarding.wizard.attemptsCommitment.attemptsSubtitle")}</p>
            <RadioGroup
              options={attemptsOptions}
              selected={form.pastAttemptsStatus}
              onSelect={(v) => patch({ pastAttemptsStatus: v })}
            />
            {form.pastAttemptsStatus !== null && form.pastAttemptsStatus !== "first" && (
              <div className="mt-3 flex flex-col gap-3">
                <div>
                  <FieldLabel>{t("onboarding.wizard.attemptsCommitment.prevScoreLabel")}</FieldLabel>
                  <input
                    className={textInputClass}
                    value={form.prevScore}
                    onChange={(e) => patch({ prevScore: e.target.value })}
                    placeholder={t("onboarding.wizard.attemptsCommitment.prevScorePlaceholder")}
                  />
                </div>
                <div>
                  <FieldLabel>{t("onboarding.wizard.attemptsCommitment.prevDateLabel")}</FieldLabel>
                  <input
                    className={textInputClass}
                    value={form.prevDate}
                    onChange={(e) => patch({ prevDate: e.target.value })}
                    placeholder={t("onboarding.wizard.attemptsCommitment.prevDatePlaceholder")}
                  />
                </div>
              </div>
            )}
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-ink">{t("onboarding.wizard.attemptsCommitment.timeTitle")}</h2>
            <p className="text-sm text-muted mt-1 mb-3">{t("onboarding.wizard.attemptsCommitment.timeSubtitle")}</p>
            <OptionGrid
              options={timeOptions.map((o) => ({ ...o, value: String(o.value) }))}
              selected={form.dailyMinutesPreference === null ? null : String(form.dailyMinutesPreference)}
              onSelect={(v) => patch({ dailyMinutesPreference: Number(v) })}
            />
          </div>
        </div>
      </WizardShell>
    );
  }

  if (step === 5) {
    const DURATION_VALUE: Record<string, AccessDuration> = {
      oneMonth: "1month",
      threeMonths: "3months",
      sixMonths: "6months",
      untilExam: "untilexam",
    };
    const durationOptions = (["oneMonth", "threeMonths", "sixMonths", "untilExam"] as const).map((key) => ({
      value: DURATION_VALUE[key],
      label: t(`onboarding.wizard.duration.${key}`),
      desc: t(`onboarding.wizard.duration.${key}Desc`),
    }));
    const invalid = form.accessDuration === null;
    return (
      <WizardShell stepIndex={5} onNext={next} onBack={back} nextDisabled={invalid}>
        <div>
          <h2 className="font-display font-bold text-xl text-ink">{t("onboarding.wizard.duration.title")}</h2>
          <p className="text-sm text-muted mt-1 mb-3">{t("onboarding.wizard.duration.subtitle")}</p>
          <OptionGrid options={durationOptions} selected={form.accessDuration} onSelect={(v) => patch({ accessDuration: v })} />
        </div>
      </WizardShell>
    );
  }

  // step === 6: consent
  return (
    <WizardShell stepIndex={6} onNext={handleFinish} onBack={back} nextDisabled={!form.consentGiven || submitting} nextLabel={submitting ? t("onboarding.wizard.consent.submitting") : t("onboarding.wizard.consent.submit")}>
      <div>
        <h2 className="font-display font-bold text-xl text-ink">{t("onboarding.wizard.consent.title")}</h2>
        <p className="text-sm text-muted mt-1">{t("onboarding.wizard.consent.subtitle")}</p>
      </div>
      <p className="text-sm text-ink">{t("onboarding.wizard.consent.body")}</p>
      <label className="flex items-start gap-2.5 rounded-input border border-rule p-3.5 cursor-pointer">
        <input
          type="checkbox"
          checked={form.consentGiven}
          onChange={(e) => patch({ consentGiven: e.target.checked })}
          className="mt-0.5 accent-navy"
        />
        <span className="text-sm text-ink">{t("onboarding.wizard.consent.checkboxLabel")}</span>
      </label>
      {error && <p className="text-sm text-error">{error}</p>}
    </WizardShell>
  );
}
