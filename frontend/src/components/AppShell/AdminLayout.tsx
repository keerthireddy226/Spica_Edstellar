import { useState } from "react";
import { ViewAsBanner } from "@/components/AppShell/ViewAsBanner";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth, type Role } from "@/hooks/useAuth";
import { LANDING_ROUTE_BY_ROLE, LOGIN_ROUTE_BY_ROLE } from "@/constants/routes";
import { AdminSidebar } from "@/components/AppShell/AdminSidebar";
import { Header } from "@/components/AppShell/Header";

// Shared shell for every non-learner console (Super Admin, Admin, Org
// Admin, Manager) — takes which role(s) this particular route group is
// for. A logged-out visitor goes to that group's own login portal; a
// logged-in user whose role belongs to a different console gets sent to
// *their own* console instead of either seeing this page or hitting a dead
// end, since no two of these consoles ever share a URL or a nav set.
export function AdminLayout({ allowedRoles }: { allowedRoles: Role[] }) {
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bumped by every sidebar click: the page opens afresh at its main view.
  const [navKey, setNavKey] = useState(0);

  if (!user) {
    return <Navigate to={LOGIN_ROUTE_BY_ROLE[allowedRoles[0]]} replace />;
  }
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={LANDING_ROUTE_BY_ROLE[user.role]} replace />;
  }

  return (
    <div className="flex h-screen bg-paper overflow-hidden">
      <AdminSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} onNavigate={() => setNavKey((k) => k + 1)} />

      <div className="flex-1 flex flex-col min-w-0">
        <ViewAsBanner />
        <Header onMenuClick={() => setDrawerOpen(true)} />
        <main className="app-surface flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          <Outlet key={navKey} />
        </main>
      </div>
    </div>
  );
}
