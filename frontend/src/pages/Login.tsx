import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, Lock, ShieldCheck } from "lucide-react";
import { isMfaChallenge, useAuth, type Role } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { AuthCard, FormField } from "@/components/AuthCard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LANDING_ROUTE_BY_ROLE, ROUTES } from "@/constants/routes";

export function Login({ allowedRoles }: { allowedRoles: Role[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, login, verifyMfa } = useAuth();
  // Set after a correct password when the account uses two-step sign-in.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [params] = useSearchParams();
  // Set after an invite or password reset, so the new account's email is
  // shown instead of whatever the browser remembers for this site.
  const [email, setEmail] = useState(() => params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Whether this email's organization signs in through its own identity provider.
  const [sso, setSso] = useState<{ sso: boolean; enforce: boolean } | null>(null);
  const ssoError = params.get("sso_error");

  useEffect(() => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSso(null);
      return;
    }
    const h = setTimeout(() => {
      fetch(`/api/sso/discover?email=${encodeURIComponent(email)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setSso)
        .catch(() => setSso(null));
    }, 400);
    return () => clearTimeout(h);
  }, [email]);

  if (user) return <Navigate to={user.mfaSetupRequired ? ROUTES.MFA_SETUP : LANDING_ROUTE_BY_ROLE[user.role]} replace />;

  function landing(u: { role: Role; mfaSetupRequired?: boolean }) {
    navigate(u.mfaSetupRequired ? ROUTES.MFA_SETUP : LANDING_ROUTE_BY_ROLE[u.role], { replace: true });
  }

  async function handleCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setSubmitting(true);
    try {
      landing(await verifyMfa(challenge, code.trim()));
    } catch (err) {
      if (err instanceof Error && err.message === "invalid_code") setError(t("auth.mfa.invalid"));
      else if (err instanceof Error && err.message === "already_logged_in") setError(t("auth.login.errorAlreadyLoggedIn"));
      else {
        setError(t("auth.mfa.expired"));
        setChallenge(null);
        setCode("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password, allowedRoles);
      if (isMfaChallenge(result)) setChallenge(result.challenge);
      else landing(result);
    } catch (err) {
      if (err instanceof Error && err.message === "invalid_credentials") {
        setError(t("auth.login.errorInvalidCredentials"));
      } else if (err instanceof Error && err.message === "email_not_verified") {
        setError(t("auth.login.errorEmailNotVerified"));
      } else if (err instanceof Error && err.message === "wrong_login_portal") {
        setError(t("auth.login.errorWrongPortal"));
      } else if (err instanceof Error && err.message === "already_logged_in") {
        setError(t("auth.login.errorAlreadyLoggedIn"));
      } else if (err instanceof Error && err.message === "organization_deactivated") {
        setError(t("auth.login.errorOrganizationDeactivated"));
      } else if (err instanceof Error && err.message === "sso_required") {
        setSso({ sso: true, enforce: true });
        setError(t("auth.sso.required"));
      } else if (err instanceof Error && err.message === "ip_not_allowed") {
        setError(t("auth.login.errorIpNotAllowed"));
      } else if (err instanceof Error && err.message === "too_many_attempts") {
        setError(t("auth.login.errorTooManyAttempts"));
      } else {
        setError(t("auth.login.errorGeneric"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (challenge) {
    return (
      <AuthCard eyebrow={t("common.appName")} title={t("auth.mfa.title")} subtitle={t("auth.mfa.subtitle")}>
        <form onSubmit={handleCode} className="flex flex-col gap-3">
          <FormField
            id="mfa-code"
            label={t("auth.mfa.codeLabel")}
            icon={<ShieldCheck size={15} />}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            required
          />
          <p className="text-[11px] text-muted">{t("auth.mfa.codeHint")}</p>
          {error && <p className="text-xs text-error">{error}</p>}
          <Button type="submit" className="mt-0.5 w-full !py-2 !text-xs" disabled={submitting || code.trim().length < 6}>
            {submitting ? t("auth.login.submitting") : t("auth.mfa.submit")}
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow={t("common.appName")} title={t("auth.login.title")} subtitle={t("auth.login.subtitle")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <FormField
          id="email"
          label={t("auth.login.emailLabel")}
          type="email"
          icon={<Mail size={15} />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("auth.login.emailPlaceholder")}
          autoComplete="email"
          required
        />
        <FormField
          id="password"
          label={t("auth.login.passwordLabel")}
          type="password"
          icon={<Lock size={15} />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("auth.login.passwordPlaceholder")}
          autoComplete="current-password"
          required
        />
        {(error || ssoError) && (
          <p className="text-xs text-error">{error ?? (ssoError === "no_account" ? t("auth.sso.noAccount") : ssoError === "already_logged_in" ? t("auth.login.errorAlreadyLoggedIn") : t("auth.sso.failed"))}</p>
        )}
        {sso?.sso && (
          <a href={`/api/sso/start?email=${encodeURIComponent(email)}`} className="block">
            <Button type="button" className="w-full !py-2 !text-xs">
              {t("auth.sso.button")}
            </Button>
          </a>
        )}
        {!sso?.enforce && (
          <Button type="submit" variant={sso?.sso ? "secondary" : "primary"} className="mt-0.5 w-full !py-2 !text-xs" disabled={submitting}>
            {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
          </Button>
        )}
        {sso?.enforce && <p className="text-[11px] text-muted">{t("auth.sso.required")}</p>}
      </form>
      <div className="flex flex-col gap-3 border-t border-rule pt-3.5">
        <div className="flex justify-between text-xs text-muted">
          <Link to={ROUTES.FORGOT_PASSWORD} className="hover:text-ink">
            {t("auth.login.forgotPassword")}
          </Link>
          {allowedRoles.includes("learner") && (
            <Link to={ROUTES.SIGNUP} className="hover:text-ink">
              {t("auth.login.createAccount")}
            </Link>
          )}
        </div>
        <LanguageSwitcher />
      </div>
    </AuthCard>
  );
}
