import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Menu, Sun, Moon, User, LogOut } from "lucide-react";
import { ROUTES, PROFILE_ROUTE_BY_ROLE } from "@/constants/routes";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { OrgBrandBadge, useBrandColor } from "@/components/AppShell/useBranding";

import { tr } from "@/i18n/tr";
function useTitleKey(pathname: string): string {
  if (pathname === ROUTES.ROADMAP) return "nav.roadmap";
  if (pathname === ROUTES.DASHBOARD) return "nav.overview";
  if (pathname === ROUTES.PROGRESS) return "nav.progress";
  if (pathname.startsWith(ROUTES.MODULES)) return "nav.modules";
  if (pathname.startsWith(ROUTES.PRACTICE_TESTS)) return "nav.practiceTests";
  if (pathname === ROUTES.TUTOR) return "nav.tutor";
  if (pathname === ROUTES.PROFILE) return "nav.profile";
  if (pathname === ROUTES.PLANS) return "plans.title";
  if (pathname === ROUTES.ADMIN_ADMINS) return "admin.nav.admins";
  if (pathname === ROUTES.ADMIN_ORG_ADMINS) return "admin.nav.orgAdmins";
  if (pathname === ROUTES.ADMIN_LEARNERS) return "admin.nav.learners";
  if (pathname === ROUTES.ADMIN_PROFILE) return "nav.profile";
  if (pathname === ROUTES.ADMIN_CONSOLE_PROFILE) return "nav.profile";
  if (pathname === ROUTES.ORG_ADMIN_PROFILE) return "nav.profile";
  if (pathname === ROUTES.MANAGER_PROFILE) return "nav.profile";
  return "common.appName";
}

// Plain-string titles for every console page that isn't covered by the
// translated learner-side nav keys above — mirrors the sidebar's own labels.
const CONSOLE_TITLE_BY_ROUTE: Record<string, string> = {
  [ROUTES.ADMIN_DASHBOARD]: tr("Super Admin Dashboard"),
  [ROUTES.ADMIN_CONSOLE_DASHBOARD]: tr("Admin Dashboard"),
  [ROUTES.ADMIN_CONSOLE_ORGANIZATIONS]: tr("Organizations"),
  [ROUTES.ADMIN_CONSOLE_USERS]: tr("Learners"),
  [ROUTES.ADMIN_CONSOLE_MANAGERS]: tr("Managers"),
  [ROUTES.ADMIN_MANAGERS]: tr("Managers"),
  [ROUTES.ORG_ADMIN_DASHBOARD]: tr("Organization Dashboard"),
  [ROUTES.ORG_ADMIN_BATCHES]: tr("Batches"),
  [ROUTES.ORG_ADMIN_PROGRAMS]: tr("Programs"),
  [ROUTES.ORG_ADMIN_MANAGERS]: tr("Managers"),
  [ROUTES.ORG_ADMIN_LEARNERS]: tr("Learners"),
  [ROUTES.ORG_ADMIN_LICENSES]: tr("Licenses"),
  [ROUTES.ORG_ADMIN_PLAN]: tr("Plan"),
  [ROUTES.ORG_ADMIN_AUDIT]: tr("Audit log"),
  [ROUTES.ORG_ADMIN_INTEGRITY]: tr("Test integrity"),
  [ROUTES.ORG_ADMIN_RECRUITMENT]: tr("Recruitment"),
  [ROUTES.RECRUITER_JOBS]: tr("Recruitment"),
  [ROUTES.RECRUITER_INTEGRITY]: tr("Test integrity"),
  [ROUTES.RECRUITER_PROFILE]: tr("Profile"),
  [ROUTES.ADMIN_CONSOLE_INTEGRITY]: tr("Test integrity"),
  [ROUTES.SUPER_INTEGRITY]: tr("Test integrity"),
  [ROUTES.ORG_ADMIN_SETTINGS]: tr("Settings"),
  [ROUTES.ORG_ADMIN_DEVELOPERS]: tr("Integrations"),
  [ROUTES.ADMIN_ANALYTICS]: tr("Analytics"),
  [ROUTES.ADMIN_CONSOLE_ANALYTICS]: tr("Analytics"),
  [ROUTES.ORG_ADMIN_ANALYTICS]: tr("Analytics"),
  [ROUTES.MANAGER_ANALYTICS]: tr("Analytics"),
  [ROUTES.MANAGER_DASHBOARD]: tr("Manager Dashboard"),
  [ROUTES.MANAGER_BATCHES]: tr("Batches"),
  [ROUTES.SUPER_ORGANIZATIONS]: tr("Organizations"),
  [ROUTES.SUPER_BILLING]: tr("Billing"),
  [ROUTES.SUPER_AUDIT]: tr("Audit log"),
  [ROUTES.SUPER_SYSTEM]: tr("System"),
  [ROUTES.SUPER_INSIGHTS]: tr("Insights"),
  [ROUTES.SUPER_PLANS]: tr("Plans & pricing"),
  [ROUTES.SUPER_CONTENT]: tr("Question bank"),
  [ROUTES.ADMIN_CONSOLE_CONTENT]: tr("Question bank"),
  [ROUTES.ADMIN_CONSOLE_ADMINS]: tr("Admins"),
  [ROUTES.ADMIN_CONSOLE_INSIGHTS]: tr("Insights"),
  [ROUTES.ADMIN_CONSOLE_PLANS]: tr("Plans & pricing"),
  [ROUTES.ADMIN_CONSOLE_ORG_ADMINS]: tr("Org Admins"),
  [ROUTES.ADMIN_CONSOLE_BILLING]: tr("Billing"),
  [ROUTES.ADMIN_CONSOLE_AUDIT]: tr("Audit log"),
  [ROUTES.ADMIN_CONSOLE_REVIEWS]: tr("Placement reviews"),
  [ROUTES.ADMIN_REVIEW]: tr("Placement reviews"),
  [ROUTES.MANAGER_LEARNERS]: tr("Learners"),
  [ROUTES.MANAGER_ACTIVITY]: tr("Activity"),
};

function initials(email: string | undefined) {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}

function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 w-8 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0 cursor-pointer"
        title={user?.email}
      >
        {initials(user?.email)}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-rule rounded-input shadow-md py-1.5 z-50">
          <p className="px-3.5 py-1.5 text-xs text-muted truncate border-b border-rule mb-1">{user?.email}</p>
          <button
            onClick={() => {
              setOpen(false);
              navigate(user ? PROFILE_ROUTE_BY_ROLE[user.role] : ROUTES.PROFILE);
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink hover:bg-paper-warm transition-colors cursor-pointer"
          >
            <User size={20} strokeWidth={1.8} />
            {t("nav.profile")}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-error hover:bg-paper-warm transition-colors cursor-pointer"
          >
            <LogOut size={20} strokeWidth={1.8} />
            {t("onboarding.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const titleKey = useTitleKey(location.pathname);
  // "Dashboard" alone didn't say which console this was.
  const title = CONSOLE_TITLE_BY_ROUTE[location.pathname] ?? t(titleKey);
  const brandColor = useBrandColor();

  return (
    <header
      className="flex items-center justify-between gap-4 border-b border-rule bg-surface px-4 sm:px-6 py-3.5 shrink-0"
      style={brandColor ? { borderTop: `3px solid ${brandColor}` } : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onMenuClick}
          aria-label={t("shell.openMenu")}
          className="lg:hidden -ml-1 p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer shrink-0"
        >
          <Menu size={24} />
        </button>
        <h1 className="font-display font-bold text-lg text-ink truncate">{title}</h1>
        <OrgBrandBadge />
      </div>

      <div className="flex items-center gap-1 sm:gap-3 shrink-0">
        <LanguageSwitcher compact />
        <button
          onClick={toggleTheme}
          aria-label={t("shell.toggleTheme")}
          className="p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer"
        >
          {theme === "dark" ? <Sun size={22} /> : <Moon size={22} />}
        </button>
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
