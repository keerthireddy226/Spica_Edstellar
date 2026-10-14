import { useEffect, useState } from "react";
import { MyCertificates } from "@/components/MyCertificates";
import { ProgressExtras } from "@/components/progress/ProgressExtras";
import { DeleteMyAccount } from "@/components/DeleteMyAccount";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  LogOut,
  GraduationCap,
  CalendarDays,
  Pencil,
  X,
  Check,
  Mail,
  User,
  Volume2,
  Clock,
  Globe,
  Mic,
  Hash,
  MapPin,
  Briefcase,
  KeyRound,
  CheckCircle2,
} from "lucide-react";
import { VoiceSection } from "@/components/VoiceSection";
import { Button } from "@/components/Button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useAuth } from "@/hooks/useAuth";
import {
  getOnboardingProfile,
  updateSpokenPromptsPreference,
  updateDemographics,
  type OnboardingProfile,
  type JobRole,
  type Gender,
  type AgeBand,
} from "@/api/onboarding";
import { AGE_BANDS, GENDERS, JOB_ROLES, countryName, sortedCountries } from "@/constants/demographics";
import { ROUTES } from "@/constants/routes";
import { useMyLicense } from "@/components/licenses/LicenseGate";
import { DailyReminderCard } from "@/components/DailyReminderCard";
import { LearningGoals, MyOrganization, useMyLearning } from "@/components/profile/LearnerExtras";
import { ActiveSessionsSection, LoginHistorySection, SecuritySection } from "@/pages/admin/AdminProfile";
import { MfaCard } from "@/components/MfaCard";
import { formatShortDate } from "@/api/licenses";

// Colored icon-in-squircle badge, reused as the visual anchor for every card header/row here.
function IconBadge({ icon: Icon, tint, size = 36 }: { icon: typeof GraduationCap; tint: string; size?: number }) {
  return (
    <span
      className={`rounded-2xl flex items-center justify-center shrink-0 ${tint}`}
      style={{ height: size, width: size }}
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={2} />
    </span>
  );
}

function SectionHeader({ icon, tint, title }: { icon: typeof GraduationCap; tint: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <IconBadge icon={icon} tint={tint} size={30} />
      <h3 className="font-display font-bold text-sm text-ink">{title}</h3>
    </div>
  );
}

function AccessSection() {
  const { t } = useTranslation();
  const license = useMyLicense();
  if (!license || (!license.required && !license.individual)) return null;
  const onFreePlan = license.individual && license.status !== "active" && license.status !== "grace";
  const status =
    license.status === "active"
      ? t("profile.access.activeUntil", { date: formatShortDate(license.accessEndsAt) })
      : license.status === "grace"
        ? t("profile.access.grace", { date: formatShortDate(license.graceEndsAt) })
        : onFreePlan
          ? t("plans.onFree")
          : license.status === "expired"
            ? t("profile.access.expired", { date: formatShortDate(license.accessEndsAt) })
            : t("profile.access.none");
  const tone =
    license.status === "active" ? "text-success" : license.status === "grace" ? "text-navy-deep" : onFreePlan ? "text-ink" : "text-error";
  return (
    <div className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-3">
      <SectionHeader icon={KeyRound} tint="bg-navy/15 text-navy" title={t("profile.access.title")} />
      <p className={`text-sm font-semibold ${tone}`}>{status}</p>
      {license.queuedMonths > 0 && (
        <p className="text-xs text-muted">{t("profile.access.queued", { count: license.queuedMonths })}</p>
      )}
      {license.status === "active" || license.status === "grace" ? (
        <div className="grid grid-cols-2 gap-2 mt-1">
          {[t("nav.modules"), t("nav.practiceTests"), t("nav.tutor"), t("nav.progress")].map((label) => (
            <span key={label} className="flex items-center gap-2 text-sm text-ink bg-success/10 rounded-input px-3 py-2">
              <CheckCircle2 size={15} className="text-success shrink-0" /> {label}
            </span>
          ))}
        </div>
      ) : license.individual ? (
        <Link to={ROUTES.PLANS} className="self-start">
          <Button variant={onFreePlan ? "primary" : "secondary"}>{onFreePlan ? t("plans.upgrade") : t("plans.title")}</Button>
        </Link>
      ) : (
        <p className="text-xs text-muted">{t("profile.access.help")}</p>
      )}
    </div>
  );
}

function PersonalInformation() {
  const { t } = useTranslation();
  const { user, updateName } = useAuth();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setEditing(true);
  }

  async function handleSave() {
    if (!firstName.trim() || !lastName.trim()) return;
    setSaving(true);
    try {
      await updateName(firstName.trim(), lastName.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const { data: learning } = useMyLearning();
  const accountType =
    user?.role === "learner" ? (learning?.organization ? `${learning.organization.name} learner` : t("profile.account.individual")) : user?.role;

  return (
    <div className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <SectionHeader icon={User} tint="bg-navy/15 text-navy" title={t("profile.personalInfo.title")} />
        {!editing && (
          <button
            onClick={startEditing}
            aria-label={t("profile.personalInfo.edit")}
            className="h-9 w-9 rounded-full flex items-center justify-center text-muted hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer shrink-0"
          >
            <Pencil size={16} strokeWidth={2} />
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">{t("profile.personalInfo.firstName")}</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-input border border-rule bg-paper px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">{t("profile.personalInfo.lastName")}</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-input border border-rule bg-paper px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy"
              />
            </div>
          </div>
          <div className="flex gap-2.5">
            <Button onClick={handleSave} disabled={saving || !firstName.trim() || !lastName.trim()}>
              <span className="flex items-center gap-1.5">
                <Check size={16} strokeWidth={2.2} />
                {saving ? t("profile.personalInfo.saving") : t("profile.personalInfo.save")}
              </span>
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
              <span className="flex items-center gap-1.5">
                <X size={16} strokeWidth={2.2} />
                {t("profile.personalInfo.cancel")}
              </span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4">
          <FieldDisplay icon={User} label={t("profile.personalInfo.firstName")} value={user?.firstName || "—"} />
          <FieldDisplay icon={User} label={t("profile.personalInfo.lastName")} value={user?.lastName || "—"} />
          <FieldDisplay icon={Mail} label={t("profile.personalInfo.email")} value={user?.email ?? ""} />
          <FieldDisplay icon={ShieldCheck} label={t("profile.personalInfo.accountType")} value={accountType ?? ""} />
          {user?.participantId && (
            <FieldDisplay icon={Hash} label={t("profile.personalInfo.participantId")} value={user.participantId} />
          )}
        </div>
      )}
    </div>
  );
}

const profileInputClass =
  "w-full rounded-input border border-rule bg-paper px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy";

function AboutYouSection() {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [jobRole, setJobRole] = useState<JobRole | "">("");
  const [gender, setGender] = useState<Gender | "">("");
  const [ageBand, setAgeBand] = useState<AgeBand | "">("");
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    getOnboardingProfile().then(setProfile).catch(() => {});
  }, []);

  if (!profile) return null;

  function startEditing() {
    setCountry(profile!.country ?? "");
    setCity(profile!.city ?? "");
    setJobRole(profile!.job_role ?? "");
    setGender(profile!.gender ?? "");
    setAgeBand(profile!.age_band ?? "");
    setConsent(Boolean(profile!.gender || profile!.age_band));
    setError(null);
    setEditing(true);
  }

  const needsConsent = Boolean(gender || ageBand);
  const invalid = !country || !city.trim() || !jobRole || (needsConsent && !consent);

  async function handleSave() {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      await updateDemographics({
        country,
        city: city.trim(),
        jobRole: jobRole as JobRole,
        gender: gender || null,
        ageBand: ageBand || null,
        demographicsConsent: consent,
      });
      setProfile({ ...profile!, country, city: city.trim(), job_role: jobRole as JobRole, gender: gender || null, age_band: ageBand || null });
      setEditing(false);
    } catch {
      setError(t("profile.about.error"));
    } finally {
      setSaving(false);
    }
  }

  const notShared = t("profile.about.notShared");

  return (
    <div className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <SectionHeader icon={MapPin} tint="bg-accent/15 text-accent" title={t("profile.about.title")} />
        {!editing && (
          <button
            onClick={startEditing}
            aria-label={t("profile.personalInfo.edit")}
            className="h-9 w-9 rounded-full flex items-center justify-center text-muted hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer shrink-0"
          >
            <Pencil size={16} strokeWidth={2} />
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">{t("onboarding.wizard.about.countryLabel")}</label>
              <select value={country} onChange={(e) => setCountry(e.target.value)} className={`${profileInputClass} cursor-pointer`}>
                <option value="">{t("onboarding.wizard.about.select")}</option>
                {sortedCountries(i18n.language).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">{t("onboarding.wizard.about.cityLabel")}</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} className={profileInputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">{t("onboarding.wizard.about.jobRoleLabel")}</label>
              <select value={jobRole} onChange={(e) => setJobRole(e.target.value as JobRole | "")} className={`${profileInputClass} cursor-pointer`}>
                <option value="">{t("onboarding.wizard.about.select")}</option>
                {JOB_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`demographics.jobRole.${r}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">{t("onboarding.wizard.about.genderLabel")}</label>
              <select value={gender} onChange={(e) => setGender(e.target.value as Gender | "")} className={`${profileInputClass} cursor-pointer`}>
                <option value="">{t("onboarding.wizard.about.skip")}</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {t(`demographics.gender.${g}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">{t("onboarding.wizard.about.ageLabel")}</label>
              <select value={ageBand} onChange={(e) => setAgeBand(e.target.value as AgeBand | "")} className={`${profileInputClass} cursor-pointer`}>
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
            <label className="flex items-start gap-2.5 rounded-input border border-rule p-3 cursor-pointer">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-navy" />
              <span className="text-sm text-ink">{t("onboarding.wizard.about.consent")}</span>
            </label>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex gap-2.5">
            <Button onClick={handleSave} disabled={saving || invalid}>
              <span className="flex items-center gap-1.5">
                <Check size={16} strokeWidth={2.2} />
                {saving ? t("profile.personalInfo.saving") : t("profile.personalInfo.save")}
              </span>
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
              <span className="flex items-center gap-1.5">
                <X size={16} strokeWidth={2.2} />
                {t("profile.personalInfo.cancel")}
              </span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4">
          <FieldDisplay icon={MapPin} label={t("onboarding.wizard.about.countryLabel")} value={countryName(profile.country, i18n.language)} />
          <FieldDisplay icon={MapPin} label={t("onboarding.wizard.about.cityLabel")} value={profile.city || "—"} />
          <FieldDisplay
            icon={Briefcase}
            label={t("onboarding.wizard.about.jobRoleLabel")}
            value={profile.job_role ? t(`demographics.jobRole.${profile.job_role}`) : "—"}
          />
          <FieldDisplay icon={User} label={t("profile.about.gender")} value={profile.gender ? t(`demographics.gender.${profile.gender}`) : notShared} />
          <FieldDisplay icon={CalendarDays} label={t("profile.about.age")} value={profile.age_band ? t(`demographics.ageBand.${profile.age_band}`) : notShared} />
        </div>
      )}
    </div>
  );
}

function FieldDisplay({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={15} strokeWidth={1.8} className="text-muted shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
        <div className="text-sm font-semibold text-ink mt-0.5 truncate">{value}</div>
      </div>
    </div>
  );
}

// Reuses the same "Coming soon" copy already used on Practice Tests' preview
// cards, rather than a new translation key for the same idea.
function ComingSoonBadge() {
  const { t } = useTranslation();
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted bg-paper-warm px-1.5 py-0.5 rounded-pill shrink-0">
      {t("practiceTests.comingSoon")}
    </span>
  );
}

function ToggleRow({
  icon,
  tint,
  title,
  subtitle,
  checked,
  disabled,
  comingSoon,
  onChange,
}: {
  icon: typeof Mail;
  tint: string;
  title: string;
  subtitle: string;
  checked: boolean;
  disabled?: boolean;
  comingSoon?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <IconBadge icon={icon} tint={tint} size={34} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{title}</span>
          {comingSoon && <ComingSoonBadge />}
        </div>
        <p className="text-xs text-muted mt-0.5">{subtitle}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={`relative h-6 w-11 rounded-pill shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed ${
          checked ? "bg-accent" : "bg-rule-strong"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}


function PreferencesSection() {
  const { t } = useTranslation();
  const [spokenPrompts, setSpokenPrompts] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getOnboardingProfile()
      .then((res) => setSpokenPrompts(res?.spoken_prompts_enabled ?? true))
      .finally(() => setLoaded(true));
  }, []);

  async function handleToggleSpokenPrompts(next: boolean) {
    setSpokenPrompts(next);
    try {
      await updateSpokenPromptsPreference(next);
    } catch {
      setSpokenPrompts(!next);
    }
  }

  return (
    <div className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-1">
      <SectionHeader icon={Volume2} tint="bg-writing/15 text-writing" title={t("profile.preferences.title")} />
      <div className="flex flex-col divide-y divide-rule mt-2">
        <ToggleRow
          icon={Volume2}
          tint="bg-accent/15 text-accent"
          title={t("profile.preferences.spokenPrompts.title")}
          subtitle={t("profile.preferences.spokenPrompts.subtitle")}
          checked={spokenPrompts}
          disabled={!loaded}
          onChange={handleToggleSpokenPrompts}
        />
        <ToggleRow
          icon={Mail}
          tint="bg-paper-warm text-muted"
          title={t("profile.preferences.weeklyReports.title")}
          subtitle={t("profile.preferences.weeklyReports.subtitle")}
          checked={false}
          disabled
          comingSoon
        />
        <ToggleRow
          icon={Clock}
          tint="bg-paper-warm text-muted"
          title={t("profile.preferences.strictTimer.title")}
          subtitle={t("profile.preferences.strictTimer.subtitle")}
          checked={false}
          disabled
          comingSoon
        />
      </div>
    </div>
  );
}

export function Profile() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: learning, reload } = useMyLearning();
  const [tab, setTab] = useState("learning");

  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || t("profile.account.unnamed");
  const accountType =
    user?.role === "learner" ? (learning?.organization ? `${learning.organization.name}${learning.batch ? ` · ${learning.batch.name}` : ""}` : t("profile.account.individual")) : user?.role;

  async function handleLogout() {
    await logout();
    navigate(ROUTES.LOGIN, { replace: true });
  }

  const tabs: [string, string][] = [
    ["learning", "Learning"],
    ["account", "Account"],
    ["settings", "Settings"],
    ["security", "Security"],
  ];
  const p = learning?.progress;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div
        className="relative overflow-hidden rounded-card shadow-sm"
        style={{ background: "linear-gradient(120deg, var(--color-navy), color-mix(in srgb, var(--color-navy) 70%, black) 70%, color-mix(in srgb, #c9965c 60%, var(--color-navy)))" }}
      >
        <span className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10" />
        <span className="pointer-events-none absolute right-48 -bottom-28 h-56 w-56 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-5 px-6 sm:px-8 pt-7 pb-5 flex-wrap">
          <span className="h-20 w-20 rounded-3xl bg-white/20 ring-2 ring-white/40 text-white flex items-center justify-center font-display font-bold text-2xl shrink-0">
            {initials}
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-2xl text-white truncate">{fullName}</h1>
            <p className="text-sm text-white/80 flex items-center gap-1.5 truncate">
              <Mail size={13} strokeWidth={1.8} />
              {user?.email}
              {user?.participantId ? ` · ${user.participantId}` : ""}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-white text-navy-deep">{accountType}</span>
              {learning?.access && (learning.access.status === "active" || learning.access.status === "grace") && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-white/20 text-white border border-white/30">Full access</span>
              )}
              {learning?.goals.examPreference && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-white/20 text-white border border-white/30">
                  Preparing for {learning.goals.examPreference.toUpperCase()}
                  {learning.goals.goalLevel && learning.goals.goalLevel !== "unsure" ? ` · goal ${learning.goals.goalLevel}` : ""}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-pill bg-white/15 border border-white/30 text-white text-sm font-semibold hover:bg-white/25 transition-colors cursor-pointer"
          >
            <LogOut size={15} strokeWidth={2} />
            {t("onboarding.logout")}
          </button>
        </div>
        {p && (
          <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3 px-6 sm:px-8 pb-6">
            {(
              [
                ["Current level", p.level ?? "Not placed", "var(--color-navy)"],
                ["Day streak", p.streak, "var(--color-accent)"],
                ["Sessions", p.sessions, "#c9965c"],
                ["Minutes practised", p.minutes, "#b97a62"],
              ] as const
            ).map(([label, value, c]) => (
              <div key={label} className="bg-surface rounded-input px-4 py-3 shadow-sm border-l-4" style={{ borderLeftColor: c }}>
                <p className="font-display font-bold text-2xl" style={{ color: `color-mix(in srgb, ${c} 80%, black)` }}>
                  {value}
                </p>
                <p className="text-xs text-muted">{label}</p>
              </div>
            ))}
          </div>
        )}
        <div className="relative flex items-center gap-1 px-4 sm:px-6 bg-surface border-t border-rule overflow-x-auto">
          {tabs.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors cursor-pointer ${tab === k ? "border-navy text-navy-deep" : "border-transparent text-muted hover:text-ink"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Two balanced columns per tab, so cards sit side by side without gaps. */}
      {(() => {
        const cols: Record<string, [React.ReactNode[], React.ReactNode[]]> = {
          learning: [
            [learning && <LearningGoals key="g" data={learning} onSaved={reload} />, <ProgressExtras key="s" part="skills" />],
            [<AccessSection key="a" />, learning && <MyOrganization key="o" data={learning} />, <MyCertificates key="c" />],
          ],
          account: [[<PersonalInformation key="p" />, <DeleteMyAccount key="d" />], [<AboutYouSection key="ab" />]],
          settings: [
            [
              <DailyReminderCard key="r" />,
              <div key="l" className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-3">
                <SectionHeader icon={Globe} tint="bg-listening/15 text-listening" title={t("profile.language.title")} />
                <LanguageSwitcher />
              </div>,
            ],
            [
              <PreferencesSection key="pr" />,
              <div key="v" className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-3">
                <SectionHeader icon={Mic} tint="bg-speaking/15 text-speaking" title={t("profile.voice.title")} />
                <VoiceSection hideTitle />
              </div>,
            ],
          ],
          security: [[<SecuritySection key="s" email={user?.email} />, <ActiveSessionsSection key="as" />], [<MfaCard key="m" />, <LoginHistorySection key="lh" />]],
        };
        const [left, right] = cols[tab];
        return (
          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <div className="flex flex-col gap-6 min-w-0">{left}</div>
            <div className="flex flex-col gap-6 min-w-0">{right}</div>
          </div>
        );
      })()}
    </div>
  );
}
