import { LicenseBanner } from "@/components/licenses/LicenseGate";
import { ViewAsBanner } from "@/components/AppShell/ViewAsBanner";
import { startTransition, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { useTestOnly } from "@/components/learner/useTestOnly";
import { Sidebar } from "@/components/AppShell/Sidebar";
import { Header } from "@/components/AppShell/Header";
import { TestFocusBar, TestFocusProvider, type TestFocus } from "@/components/AppShell/testFocus";

// The learning pages someone who bought only a test doesn't have: a link or
// an old bookmark to one of them opens Assessment instead.
// (Plans stays open: Spica plans sends them there to buy more.)
const LEARNING_PAGES: string[] = [ROUTES.ROADMAP, ROUTES.DASHBOARD, ROUTES.PROGRESS, ROUTES.MODULES, ROUTES.MOCK_EXAMS, ROUTES.TUTOR];
function hiddenForTestOnly(pathname: string): boolean {
  if (LEARNING_PAGES.includes(pathname)) return true;
  // Practice tests are hidden; a report opened from My reports isn't.
  return pathname === ROUTES.PRACTICE_TESTS;
}

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bumped by every sidebar click: the page is opened afresh at its main
  // view (not a sub-page or tab left open), even when it's the same page.
  // Bumped in a transition, like the router's own location change, so both
  // land together: bumped alone, the old page remounts first and its URL
  // tidying (?product=...) undoes the new link.
  const [navKey, setNavKey] = useState(0);
  const testOnly = useTestOnly();
  const { pathname } = useLocation();
  // A timed test in progress: no menu or header, only its own bar.
  const [focus, setFocus] = useState<TestFocus | null>(null);

  return (
    // Printed (a report's "Download PDF"): only the page itself, at full length.
    <div className="flex h-screen bg-paper overflow-hidden print:block print:h-auto print:overflow-visible print:bg-white">
      <div className={focus ? "hidden" : "contents print:hidden"}>
        <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} onNavigate={() => startTransition(() => setNavKey((k) => k + 1))} />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="contents print:hidden">
          <ViewAsBanner />
          {focus ? <TestFocusBar focus={focus} /> : <Header onMenuClick={() => setDrawerOpen(true)} />}
        </div>
        <main className="app-surface flex-1 overflow-y-auto px-4 sm:px-6 py-6 print:overflow-visible print:p-0">
          <div className={focus ? "hidden" : "print:hidden"}>
            <LicenseBanner />
          </div>
          <TestFocusProvider value={setFocus}>
            {testOnly && hiddenForTestOnly(pathname) ? <Navigate to={ROUTES.MY_TESTS} replace /> : <Outlet key={navKey} />}
          </TestFocusProvider>
        </main>
      </div>
    </div>
  );
}
