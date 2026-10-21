import { LicenseBanner } from "@/components/licenses/LicenseGate";
import { ViewAsBanner } from "@/components/AppShell/ViewAsBanner";
import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/AppShell/Sidebar";
import { Header } from "@/components/AppShell/Header";

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bumped by every sidebar click: the page is opened afresh at its main
  // view (not a sub-page or tab left open), even when it's the same page.
  const [navKey, setNavKey] = useState(0);

  return (
    // Printed (a report's "Download PDF"): only the page itself, at full length.
    <div className="flex h-screen bg-paper overflow-hidden print:block print:h-auto print:overflow-visible print:bg-white">
      <div className="contents print:hidden">
        <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} onNavigate={() => setNavKey((k) => k + 1)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="contents print:hidden">
          <ViewAsBanner />
          <Header onMenuClick={() => setDrawerOpen(true)} />
        </div>
        <main className="app-surface flex-1 overflow-y-auto px-4 sm:px-6 py-6 print:overflow-visible print:p-0">
          <div className="print:hidden">
            <LicenseBanner />
          </div>
          <Outlet key={navKey} />
        </main>
      </div>
    </div>
  );
}
