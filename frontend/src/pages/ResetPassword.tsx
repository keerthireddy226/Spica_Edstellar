import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { passwordErrorText } from "@/lib/passwordErrors";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { AuthCard, FormField } from "@/components/AuthCard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LOGIN_ROUTE_BY_ROLE, ROUTES } from "@/constants/routes";

export function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { resetPassword } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Whose account this link is for. Shown on the page, and given to the
  // browser so it saves the new password under this email rather than
  // another account it remembers for the site.
  const [account, setAccount] = useState<{ email: string; firstName: string | null } | null>(null);

  useEffect(() => {
    if (!token) return;
    api<{ email: string; firstName: string | null }>(`/auth/reset-password/info?token=${encodeURIComponent(token)}`)
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("auth.resetPassword.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.resetPassword.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const { role } = await resetPassword(token, password);
      navigate(account ? `${LOGIN_ROUTE_BY_ROLE[role]}?email=${encodeURIComponent(account.email)}` : LOGIN_ROUTE_BY_ROLE[role], { replace: true });
    } catch (err) {
      setError(passwordErrorText(err, t) ?? t("auth.resetPassword.error"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthCard
        eyebrow={t("common.appName")}
        title={t("auth.resetPassword.missingTokenTitle")}
        subtitle={t("auth.resetPassword.missingTokenSubtitle")}
      >
        <p className="text-center text-sm text-muted">
          <Link to={ROUTES.FORGOT_PASSWORD} className="hover:text-ink">
            {t("auth.resetPassword.requestNewLink")}
          </Link>
        </p>
        <LanguageSwitcher />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow={t("common.appName")}
      title={t("auth.resetPassword.title")}
      subtitle={t("auth.resetPassword.subtitle")}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {account && (
          <>
            <p className="text-xs text-center text-muted -mt-1">
              For <span className="font-semibold text-ink">{account.email}</span>
            </p>
            {/* Tells the browser's password manager which account this is. */}
            <input type="email" name="username" autoComplete="username" value={account.email} readOnly hidden />
          </>
        )}
        <FormField
          id="password"
          label={t("auth.resetPassword.passwordLabel")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("auth.resetPassword.passwordPlaceholder")}
          autoComplete="new-password"
          required
        />
        <FormField
          id="confirmPassword"
          label={t("auth.resetPassword.confirmPasswordLabel")}
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={t("auth.resetPassword.confirmPasswordPlaceholder")}
          autoComplete="new-password"
          required
        />
        {error && <p className="text-sm text-error">{error}</p>}
        <Button type="submit" className="mt-1 w-full" disabled={submitting}>
          {submitting ? t("auth.resetPassword.submitting") : t("auth.resetPassword.submit")}
        </Button>
      </form>
      <LanguageSwitcher />
    </AuthCard>
  );
}
