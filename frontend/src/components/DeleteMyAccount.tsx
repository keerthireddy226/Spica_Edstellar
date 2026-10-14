import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { ApiError, api } from "@/lib/api";
import { ROUTES } from "@/constants/routes";

// A learner erasing their own personal data.
export function DeleteMyAccount() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="bg-surface border border-error/30 rounded-card shadow-sm p-6 flex flex-col gap-3">
      <h2 className="font-display font-bold text-lg text-ink">{t("profile.deleteAccount.title")}</h2>
      <p className="text-sm text-muted">{t("profile.deleteAccount.body")}</p>
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)} className="self-start">
          {t("profile.deleteAccount.title")}
        </Button>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("profile.deleteAccount.password")}
            className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
          />
          <Button
            disabled={busy || !password}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api("/auth/me/erase", { method: "POST", body: JSON.stringify({ password }) });
                window.location.assign(ROUTES.LOGIN);
              } catch (err) {
                setError(err instanceof ApiError && err.message === "invalid_credentials" ? t("profile.deleteAccount.wrongPassword") : t("auth.login.errorGeneric"));
                setBusy(false);
              }
            }}
            className="!bg-error !text-white"
          >
            {t("profile.deleteAccount.button")}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
