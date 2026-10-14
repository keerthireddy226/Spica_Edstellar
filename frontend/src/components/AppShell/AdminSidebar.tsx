import { Link, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { GraduationCap, LayoutDashboard, ShieldCheck, Building2, Users, User, Layers, UserCog, KeyRound, BarChart3, Gem } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { useAuth, type Role } from "@/hooks/useAuth";

// Four genuinely different nav sets, one per non-learner role — each sees
// strictly less than the role above it: Super Admin manages every org and
// every Admin; an Admin only sees organizations assigned to them; an Org
// Admin only their one organization (every batch, every Manager); a Manager
// only the batch(es) assigned to them, never the whole organization.
const SUPER_ADMIN_NAV_ITEMS: { to: string; icon: LucideIcon; label: string }[] = [
  { to: ROUTES.ADMIN_DASHBOARD, icon: LayoutDashboard, label: "Dashboard" },
  { to: ROUTES.ADMIN_ADMINS, icon: ShieldCheck, label: "Admins" },
  { to: ROUTES.ADMIN_ORG_ADMINS, icon: Building2, label: "Org Admins" },
  { to: ROUTES.ADMIN_MANAGERS, icon: UserCog, label: "Managers" },
  { to: ROUTES.ADMIN_LEARNERS, icon: Users, label: "Individual Learners" },
  { to: ROUTES.ADMIN_ANALYTICS, icon: BarChart3, label: "Analytics" },
  { to: ROUTES.ADMIN_PROFILE, icon: User, label: "Profile" },
];

const ADMIN_CONSOLE_NAV_ITEMS: { to: string; icon: LucideIcon; label: string }[] = [
  { to: ROUTES.ADMIN_CONSOLE_DASHBOARD, icon: LayoutDashboard, label: "Dashboard" },
  { to: ROUTES.ADMIN_CONSOLE_ORGANIZATIONS, icon: Building2, label: "Organizations" },
  { to: ROUTES.ADMIN_CONSOLE_MANAGERS, icon: UserCog, label: "Managers" },
  { to: ROUTES.ADMIN_CONSOLE_USERS, icon: Users, label: "Users" },
  { to: ROUTES.ADMIN_CONSOLE_ANALYTICS, icon: BarChart3, label: "Analytics" },
  { to: ROUTES.ADMIN_CONSOLE_PROFILE, icon: User, label: "Profile" },
];

const ORG_ADMIN_NAV_ITEMS: { to: string; icon: LucideIcon; label: string }[] = [
  { to: ROUTES.ORG_ADMIN_DASHBOARD, icon: LayoutDashboard, label: "Dashboard" },
  { to: ROUTES.ORG_ADMIN_BATCHES, icon: Layers, label: "Batches" },
  { to: ROUTES.ORG_ADMIN_MANAGERS, icon: ShieldCheck, label: "Managers" },
  { to: ROUTES.ORG_ADMIN_LEARNERS, icon: Users, label: "Learners" },
  { to: ROUTES.ORG_ADMIN_LICENSES, icon: KeyRound, label: "Licenses" },
  { to: ROUTES.ORG_ADMIN_PLAN, icon: Gem, label: "Plan" },
  { to: ROUTES.ORG_ADMIN_ANALYTICS, icon: BarChart3, label: "Analytics" },
  { to: ROUTES.ORG_ADMIN_PROFILE, icon: User, label: "Profile" },
];

const MANAGER_NAV_ITEMS: { to: string; icon: LucideIcon; label: string }[] = [
  { to: ROUTES.MANAGER_DASHBOARD, icon: LayoutDashboard, label: "Dashboard" },
  { to: ROUTES.MANAGER_LEARNERS, icon: Users, label: "Learners" },
  { to: ROUTES.MANAGER_ANALYTICS, icon: BarChart3, label: "Analytics" },
  { to: ROUTES.MANAGER_PROFILE, icon: User, label: "Profile" },
];

const NAV_ITEMS_BY_ROLE: Partial<Record<Role, { to: string; icon: LucideIcon; label: string }[]>> = {
  super_admin: SUPER_ADMIN_NAV_ITEMS,
  admin: ADMIN_CONSOLE_NAV_ITEMS,
  org_admin: ORG_ADMIN_NAV_ITEMS,
  manager: MANAGER_NAV_ITEMS,
};

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
  const navItems = (user && NAV_ITEMS_BY_ROLE[user.role]) ?? ADMIN_CONSOLE_NAV_ITEMS;

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
            <span className="text-logo-primary font-logo font-bold text-xl">Spica</span>
            <span className="text-logo-accent font-logo italic text-xs -mt-0.5">by Edstellar</span>
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to} onClick={onClose} className={navClasses(location.pathname === to)}>
              <Icon size={22} strokeWidth={1.8} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
