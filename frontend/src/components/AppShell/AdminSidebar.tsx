import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { GraduationCap, LayoutDashboard, ShieldCheck, Building2, Users, User, Layers, UserCog, KeyRound, BarChart3, Gem, ScrollText, Settings, Plug, Briefcase, CreditCard, ScanFace, ServerCog, Lightbulb, ShieldAlert, UserSearch, Target, FileStack } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { useAuth, type Role } from "@/hooks/useAuth";
import { useBranding } from "@/components/AppShell/useBranding";
import type { StaffPermissions } from "@/api/staff";
import { getPendingReviewCount } from "@/api/proctoring";

import { tr } from "@/i18n/tr";
// Four genuinely different nav sets, one per non-learner role — each sees
// strictly less than the role above it: Super Admin manages every org and
// every Admin; an Admin only sees organizations assigned to them; an Org
// Admin only their one organization (every batch, every Manager); a Manager
// only the batch(es) assigned to them, never the whole organization.
// `product`: shown only when the organization bought that product.
type NavItem = { to: string; icon: LucideIcon; label: string; permission?: keyof StaffPermissions; product?: "skills" | "recruitment" };

const SUPER_ADMIN_NAV_ITEMS: NavItem[] = [
  { to: ROUTES.ADMIN_DASHBOARD, icon: LayoutDashboard, label: tr("Dashboard") },
  { to: ROUTES.SUPER_ORGANIZATIONS, icon: Building2, label: tr("Organizations") },
  { to: ROUTES.ADMIN_ADMINS, icon: ShieldCheck, label: tr("Admins") },
  { to: ROUTES.ADMIN_ORG_ADMINS, icon: Briefcase, label: tr("Org Admins") },
  { to: ROUTES.ADMIN_MANAGERS, icon: UserCog, label: tr("Managers") },
  { to: ROUTES.ADMIN_LEARNERS, icon: Users, label: tr("Learners") },
  { to: ROUTES.SUPER_INSIGHTS, icon: Lightbulb, label: tr("Insights") },
  { to: ROUTES.SUPER_BILLING, icon: CreditCard, label: tr("Billing") },
  { to: ROUTES.SUPER_PLANS, icon: Gem, label: tr("Plans & pricing") },
  { to: ROUTES.SUPER_CONTENT, icon: FileStack, label: tr("Question bank") },
  { to: ROUTES.ADMIN_REVIEW, icon: ScanFace, label: tr("Placement reviews") },
  { to: ROUTES.SUPER_INTEGRITY, icon: ShieldAlert, label: tr("Test integrity") },
  { to: ROUTES.SUPER_AUDIT, icon: ScrollText, label: tr("Audit log") },
  { to: ROUTES.SUPER_SYSTEM, icon: ServerCog, label: tr("System") },
  { to: ROUTES.ADMIN_ANALYTICS, icon: BarChart3, label: tr("Analytics") },
  { to: ROUTES.ADMIN_PROFILE, icon: User, label: tr("Profile") },
];

const ADMIN_CONSOLE_NAV_ITEMS: NavItem[] = [
  { to: ROUTES.ADMIN_CONSOLE_DASHBOARD, icon: LayoutDashboard, label: tr("Dashboard") },
  { to: ROUTES.ADMIN_CONSOLE_ORGANIZATIONS, icon: Building2, label: tr("Organizations") },
  { to: ROUTES.ADMIN_CONSOLE_ADMINS, icon: ShieldCheck, label: tr("Admins"), permission: "manageAdmins" },
  { to: ROUTES.ADMIN_CONSOLE_ORG_ADMINS, icon: Briefcase, label: tr("Org Admins") },
  { to: ROUTES.ADMIN_CONSOLE_MANAGERS, icon: UserCog, label: tr("Managers") },
  { to: ROUTES.ADMIN_CONSOLE_USERS, icon: Users, label: tr("Learners") },
  { to: ROUTES.ADMIN_CONSOLE_INSIGHTS, icon: Lightbulb, label: tr("Insights"), permission: "viewReports" },
  { to: ROUTES.ADMIN_CONSOLE_BILLING, icon: CreditCard, label: tr("Billing") },
  { to: ROUTES.ADMIN_CONSOLE_PLANS, icon: Gem, label: tr("Plans & pricing") },
  { to: ROUTES.ADMIN_CONSOLE_CONTENT, icon: FileStack, label: tr("Question bank"), permission: "contentReview" },
  { to: ROUTES.ADMIN_CONSOLE_REVIEWS, icon: ScanFace, label: tr("Placement reviews"), permission: "scoreReview" },
  { to: ROUTES.ADMIN_CONSOLE_INTEGRITY, icon: ShieldAlert, label: tr("Test integrity"), permission: "scoreReview" },
  { to: ROUTES.ADMIN_CONSOLE_AUDIT, icon: ScrollText, label: tr("Audit log") },
  { to: ROUTES.ADMIN_CONSOLE_ANALYTICS, icon: BarChart3, label: tr("Analytics"), permission: "viewReports" },
  { to: ROUTES.ADMIN_CONSOLE_PROFILE, icon: User, label: tr("Profile") },
];

const ORG_ADMIN_NAV_ITEMS: NavItem[] = [
  { to: ROUTES.ORG_ADMIN_DASHBOARD, icon: LayoutDashboard, label: tr("Dashboard"), product: "skills" },
  { to: ROUTES.ORG_ADMIN_BATCHES, icon: Layers, label: tr("Batches"), product: "skills" },
  { to: ROUTES.ORG_ADMIN_PROGRAMS, icon: Target, label: tr("Programs"), product: "skills" },
  { to: ROUTES.ORG_ADMIN_MANAGERS, icon: ShieldCheck, label: tr("Managers"), product: "skills" },
  { to: ROUTES.ORG_ADMIN_LEARNERS, icon: Users, label: tr("Learners"), product: "skills" },
  { to: ROUTES.ORG_ADMIN_LICENSES, icon: KeyRound, label: tr("Licenses"), product: "skills" },
  { to: ROUTES.ORG_ADMIN_RECRUITMENT, icon: UserSearch, label: tr("Recruitment"), product: "recruitment" },
  { to: ROUTES.ORG_ADMIN_INTEGRITY, icon: ShieldAlert, label: tr("Test integrity") },
  { to: ROUTES.ORG_ADMIN_AUDIT, icon: ScrollText, label: tr("Audit log") },
  { to: ROUTES.ORG_ADMIN_PLAN, icon: Gem, label: tr("Plan") },
  { to: ROUTES.ORG_ADMIN_SETTINGS, icon: Settings, label: tr("Settings") },
  { to: ROUTES.ORG_ADMIN_DEVELOPERS, icon: Plug, label: tr("Integrations") },
  { to: ROUTES.ORG_ADMIN_ANALYTICS, icon: BarChart3, label: tr("Analytics"), product: "skills" },
  { to: ROUTES.ORG_ADMIN_PROFILE, icon: User, label: tr("Profile") },
];

const RECRUITER_NAV_ITEMS: NavItem[] = [
  { to: ROUTES.RECRUITER_JOBS, icon: UserSearch, label: tr("Recruitment") },
  { to: ROUTES.RECRUITER_INTEGRITY, icon: ShieldAlert, label: tr("Test integrity") },
  { to: ROUTES.RECRUITER_PROFILE, icon: User, label: tr("Profile") },
];

const MANAGER_NAV_ITEMS: { to: string; icon: LucideIcon; label: string }[] = [
  { to: ROUTES.MANAGER_DASHBOARD, icon: LayoutDashboard, label: tr("Dashboard") },
  { to: ROUTES.MANAGER_BATCHES, icon: Layers, label: tr("Batches") },
  { to: ROUTES.MANAGER_PROGRAMS, icon: Target, label: tr("Programs") },
  { to: ROUTES.MANAGER_LEARNERS, icon: Users, label: tr("Learners") },
  { to: ROUTES.MANAGER_ANALYTICS, icon: BarChart3, label: tr("Analytics") },
  { to: ROUTES.MANAGER_ACTIVITY, icon: ScrollText, label: tr("Activity") },
  { to: ROUTES.MANAGER_PROFILE, icon: User, label: tr("Profile") },
];

const NAV_ITEMS_BY_ROLE: Partial<Record<Role, NavItem[]>> = {
  super_admin: SUPER_ADMIN_NAV_ITEMS,
  admin: ADMIN_CONSOLE_NAV_ITEMS,
  org_admin: ORG_ADMIN_NAV_ITEMS,
  manager: MANAGER_NAV_ITEMS,
  recruiter: RECRUITER_NAV_ITEMS,
};

const INTEGRITY_PATHS = new Set<string>([ROUTES.SUPER_INTEGRITY, ROUTES.ADMIN_CONSOLE_INTEGRITY, ROUTES.ORG_ADMIN_INTEGRITY, ROUTES.RECRUITER_INTEGRITY]);

// Tests waiting for review, for the count next to "Test integrity". Refreshed
// every minute and on every page change.
function usePendingReviewCount(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      getPendingReviewCount()
        .then((r) => setCount(r.flagged))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [enabled, pathname]);
  return count;
}

function navClasses(isActive: boolean) {
  return [
    "flex items-center gap-3 rounded-input px-3 py-2.5 text-sm font-medium transition-colors",
    isActive ? "bg-navy-soft text-lime" : "text-lime/60 hover:bg-white/5 hover:text-lime/90",
  ].join(" ");
}

// A separate, much shorter nav than the learner Sidebar — none of
// Roadmap/Modules/Practice Tests/Tutor apply to an admin role, and reusing
// the learner Sidebar would also pull in its hasPlacement-lock logic, which
// doesn't make sense for an account with no placement of its own.
export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const { user } = useAuth();
  const perms = (user?.permissions ?? {}) as Partial<StaffPermissions>;
  const products = useBranding()?.products;
  // An Admin only sees pages their permissions allow; an organization only
  // the products it bought.
  const navItems = ((user && NAV_ITEMS_BY_ROLE[user.role]) ?? ADMIN_CONSOLE_NAV_ITEMS).filter(
    (n) => (!n.permission || user?.role !== "admin" || perms[n.permission]) && (!n.product || !products || products.includes(n.product)),
  );
  const integrityPath = navItems.find((n) => INTEGRITY_PATHS.has(n.to))?.to ?? null;
  const pendingReviews = usePendingReviewCount(Boolean(integrityPath), location.pathname);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />}

      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-sidebar flex flex-col transition-transform duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="h-11 w-11 rounded-input bg-lime text-navy flex items-center justify-center shrink-0">
            <GraduationCap size={28} strokeWidth={1.8} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-logo-primary font-logo font-bold text-xl">{tr("Spica")}</span>
            <span className="text-logo-accent font-logo italic text-xs -mt-0.5">{tr("by Edstellar")}</span>
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to} onClick={onClose} className={navClasses(location.pathname === to)}>
              <Icon size={22} strokeWidth={1.8} />
              <span className="flex-1">{label}</span>
              {to === integrityPath && pendingReviews > 0 && (
                <span className="min-w-6 h-6 px-1.5 rounded-pill bg-error text-white text-xs font-bold flex items-center justify-center" aria-label={tr("{{n}} waiting for review", { n: pendingReviews })}>
                  {pendingReviews > 99 ? "99+" : pendingReviews}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
