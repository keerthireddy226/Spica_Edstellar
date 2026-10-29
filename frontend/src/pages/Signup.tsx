import { useState, type FormEvent } from "react";
import { passwordErrorText } from "@/lib/passwordErrors";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { AuthCard, FormField } from "@/components/AuthCard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PRIVACY_NOTICE_URL, ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

export function Signup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, signup } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  if (user) return <Navigate to={ROUTES.ONBOARDING} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("auth.signup.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.signup.passwordMismatch"));
      return;
    }
    if (!agreed) {
      setError(tr("Please read the Privacy Notice and tick the box to continue."));
      return;
    }
    if (!adult) {
      setError(tr("Please confirm you are 18 or older."));
      return;
    }
    setSubmitting(true);
    try {
      await signup(email, password, firstName, lastName);
      setSubmittedEmail(email);
    } catch (err) {
      setError(
        passwordErrorText(err, t) ??
          (err instanceof Error && err.message === "email_already_registered" ? t("auth.signup.errorEmailTaken") : t("auth.signup.errorGeneric")),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedEmail) {
    return (
      <AuthCard eyebrow={t("common.appName")} title={t("auth.signup.checkEmailTitle")} subtitle="">
        <p className="text-sm text-ink text-center">
          {t("auth.signup.checkEmailBody", { email: submittedEmail })}
        </p>
        <Button className="mt-1 w-full" onClick={() => navigate(ROUTES.LOGIN)}>
          {t("auth.signup.signInButton")}
        </Button>
        <LanguageSwitcher />
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow={t("common.appName")} title={t("auth.signup.title")} subtitle={t("auth.signup.subtitle")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField
          id="firstName"
          label={t("auth.signup.firstNameLabel")}
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder={t("auth.signup.firstNamePlaceholder")}
          autoComplete="given-name"
          required
        />
        <FormField
          id="lastName"
          label={t("auth.signup.lastNameLabel")}
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder={t("auth.signup.lastNamePlaceholder")}
          autoComplete="family-name"
          required
        />
        <FormField
          id="email"
          label={t("auth.signup.emailLabel")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("auth.signup.emailPlaceholder")}
          autoComplete="email"
          required
        />
        <FormField
          id="password"
          label={t("auth.signup.passwordLabel")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("auth.signup.passwordPlaceholder")}
          autoComplete="new-password"
          required
        />
        <FormField
          id="confirmPassword"
          label={t("auth.signup.confirmPasswordLabel")}
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={t("auth.signup.confirmPasswordPlaceholder")}
          autoComplete="new-password"
          required
        />
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {tr("I have read the")}{" "}
            <a href={PRIVACY_NOTICE_URL.free} target="_blank" rel="noreferrer" className="font-medium underline">
              {tr("Privacy Notice")}
            </a>{" "}
            {tr("and agree to how Spica uses my data.")}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{tr("I am 18 or older.")}</span>
        </label>
        {error && <p className="text-sm text-error">{error}</p>}
        <Button type="submit" className="mt-1 w-full" disabled={submitting}>
          {submitting ? t("auth.signup.submitting") : t("auth.signup.submit")}
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        {t("auth.signup.alreadyHaveAccount")}{" "}
        <Link to={ROUTES.LOGIN} className="text-ink font-medium hover:underline">
          {t("auth.signup.signIn")}
        </Link>
      </p>
      <LanguageSwitcher />
    </AuthCard>
  );
}
