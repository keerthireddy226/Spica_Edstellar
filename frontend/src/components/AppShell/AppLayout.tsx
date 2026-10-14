import { LicenseBanner } from "@/components/licenses/LicenseGate";
import { ViewAsBanner } from "@/components/AppShell/ViewAsBanner";
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/AppShell/Sidebar";
import { Header } from "@/components/AppShell/Header";

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen bg-paper overflow-hidden">
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <ViewAsBanner />
        <Header onMenuClick={() => setDrawerOpen(true)} />
        <main className="app-surface flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          <LicenseBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
