import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, Lock } from "lucide-react";
import { useAuth, type Role } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { AuthCard, FormField } from "@/components/AuthCard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LANDING_ROUTE_BY_ROLE, ROUTES } from "@/constants/routes";

export function Login({ allowedRoles }: { allowedRoles: Role[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={LANDING_ROUTE_BY_ROLE[user.role]} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const loggedInUser = await login(email, password, allowedRoles);
      navigate(LANDING_ROUTE_BY_ROLE[loggedInUser.role], { replace: true });
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
      } else if (err instanceof Error && err.message === "too_many_attempts") {
        setError(t("auth.login.errorTooManyAttempts"));
      } else {
        setError(t("auth.login.errorGeneric"));
      }
    } finally {
      setSubmitting(false);
    }
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
        {error && <p className="text-xs text-error">{error}</p>}
        <Button type="submit" className="mt-0.5 w-full !py-2 !text-xs" disabled={submitting}>
          {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
        </Button>
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
