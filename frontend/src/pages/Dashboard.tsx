import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/hooks/useAuth";

// Learners have no Overview page any more: its cards moved to Progress (level,
// today's tasks, unfinished practice) and My journey, so the old address
// opens My journey, the learner's home.
export function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (user?.role === "learner") {
    return <Navigate to={ROUTES.ROADMAP} replace />;
  }

  return (
    <div className="max-w-2xl mx-auto bg-surface border border-rule rounded-card p-6 flex flex-col gap-4">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{t("dashboard.welcome", { email: user?.email })}</h1>
        <p className="text-sm text-muted mt-1">{t("dashboard.role", { role: user?.role })}</p>
      </div>
      <p className="text-sm text-muted">{t("dashboard.placeholder")}</p>
    </div>
  );
}
