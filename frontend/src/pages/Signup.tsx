import { useEffect, useState, type FormEvent } from "react";
import { PrivacyNoticeModal } from "@/pages/PrivacyNoticeDoc";
import { passwordErrorText } from "@/lib/passwordErrors";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { AuthCard, FormField } from "@/components/AuthCard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";
import { MarketingCheckbox, TermsCheckbox, useLegal } from "@/components/TermsAndMarketing";

export function Signup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, signup } = useAuth();
  // An Affiliate Partner's link (?ref=CODE) fills the partner code; it can be typed too.
  const [params] = useSearchParams();
  const refFromLink = (params.get("ref") ?? "").toUpperCase().slice(0, 20);
  const [partnerCode, setPartnerCode] = useState(() => refFromLink);
  // Count the visit for the Affiliate (once per browser session per code; no personal data).
  useEffect(() => {
    if (!refFromLink) return;
    try {
      const key = `spica-ref-click-${refFromLink}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked: still count; the server keeps one per visitor per day */
    }
    fetch("/api/partner-link/click", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: refFromLink, src: params.get("src") ?? undefined }) }).catch(() => {});
  }, [refFromLink]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  // The notice opens over the form, so nothing typed is lost.
  const [showNotice, setShowNotice] = useState(false);
  const [adult, setAdult] = useState(false);
  const legal = useLegal();
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
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
    if (legal?.termsVersion && !terms) {
      setError(tr("Please agree to the Terms and Conditions to continue."));
      return;
    }
    setSubmitting(true);
    try {
      await signup(email, password, firstName, lastName, { acceptTerms: legal?.termsVersion ? terms : undefined, marketingConsent: marketing, referralCode: partnerCode.trim() || undefined, referralSource: partnerCode.trim() && partnerCode.trim().toUpperCase() === refFromLink ? "link" : "code", referralSrc: params.get("src") ?? undefined });
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
            <button type="button" onClick={() => setShowNotice(true)} className="font-medium underline cursor-pointer">
              {tr("Privacy Notice")}
            </button>{" "}
            {tr("and agree to how Spica uses my data.")}
          </span>
        </label>
        {/* Outside the label, so clicks in the notice don't tick the box. */}
        {showNotice && <PrivacyNoticeModal audience="free" onClose={() => setShowNotice(false)} />}
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{tr("I am 18 or older.")}</span>
        </label>
        <TermsCheckbox legal={legal} checked={terms} onChange={setTerms} />
        <MarketingCheckbox checked={marketing} onChange={setMarketing} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{tr("Partner code (optional)")}</span>
          <input
            className="w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:border-navy"
            value={partnerCode}
            maxLength={20}
            onChange={(e) => setPartnerCode(e.target.value.toUpperCase())}
            placeholder="AF-XXXXXX"
          />
          <span className="text-xs text-muted">{tr("If a Spica partner sent you, their code is shared with them only as a count of sign-ups and purchases, never your name or results.")}</span>
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
