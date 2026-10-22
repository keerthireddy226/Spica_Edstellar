import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Lock, AlertTriangle, Sparkles } from "lucide-react";
import { getMyLicense, formatShortDate, type MyLicense } from "@/api/licenses";
import { getMyAccess, type MyAccess } from "@/api/access";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";

import { tr } from "@/i18n/tr";
import { KeepGoingCard } from "@/components/licenses/KeepGoingCard";
export type GatedFeature = "practice" | "mocktest" | "placement" | "coach";

// Fresh on every mount: free-tier usage changes as the learner practises,
// and access changes the moment a payment or an admin assignment lands.
export function useMyLicense(): MyLicense | null {
  const { user } = useAuth();
  const [license, setLicense] = useState<MyLicense | null>(null);
  useEffect(() => {
    if (!user || user.role !== "learner") return;
    getMyLicense()
      .then(setLicense)
      .catch(() => {});
  }, [user]);
  return license;
}

// What the learner owns besides a licence (Full access given by Spica staff,
// one test's preparation, a practice pack, a real test). undefined while it
// loads, null when it couldn't be read (then only the licence counts).
export function useMyAccessForGate(): MyAccess | null | undefined {
  const { user } = useAuth();
  const [access, setAccess] = useState<MyAccess | null | undefined>(undefined);
  useEffect(() => {
    if (!user || user.role !== "learner") return;
    getMyAccess()
      .then(setAccess)
      .catch(() => setAccess(null));
  }, [user]);
  return access;
}

function isLive(l: MyLicense): boolean {
  return l.status === "active" || l.status === "grace";
}

// Whether something the learner owns opens this page, the same rules the
// server's gate uses (licenses/gate.ts). Full access opens everything.
// Preparation opens Practice Modules (its own test's question types, which
// the page and the server narrow to) and the practice and mock tests page
// (its own test is marked there); a practice pack opens Practice Modules; a
// real test or level test opens the tests page, where it is started. The AI
// tutor needs Full access; placement follows the free rules.
function ownedOpens(a: MyAccess, feature: GatedFeature): boolean {
  if (a.full) return true;
  if (feature === "practice") return a.practicePack || a.prepTests.length > 0;
  if (feature === "mocktest") return a.prepTests.length > 0 || a.attempts.length > 0;
  return false;
}

// Practice and mock-test practice for free, with weekly or monthly limits:
// not shown to anyone whose access goes beyond the free plan.
function beyondFree(a: MyAccess | null | undefined): boolean {
  return !!a && (!!a.full || a.practicePack || a.prepTests.length > 0);
}

// The server's answer when a learner starts something their purchase doesn't
// include. Pages that start sessions send it here (lockedByServer) so the
// gate shows the standard locked state instead of a generic error.
const LOCKED_EVENT = "spica:locked";
const LOCK_CODES = ["type_not_included"];
export function isLockedError(err: unknown): boolean {
  return err instanceof Error && LOCK_CODES.includes(err.message);
}
export function lockedByServer(err: unknown): boolean {
  if (!isLockedError(err)) return false;
  window.dispatchEvent(new CustomEvent(LOCKED_EVENT, { detail: (err as Error).message }));
  return true;
}

function individualBlocked(l: MyLicense, feature: GatedFeature): boolean {
  if (!l.individual || isLive(l) || !l.freeTier) return false;
  // Practice tests and mock tests: free learners get a few each month,
  // shown and enforced on the page itself.
  if (feature === "mocktest") return false;
  if (feature === "coach") return true;
  if (feature === "placement") return l.freeTier.placementTaken;
  return !l.freeTier.hasOpenPractice && l.freeTier.practiceUsed >= l.freeTier.practiceLimit;
}

function LockCard({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action: ReactNode }) {
  return (
    <div className="app-surface min-h-[60vh] flex items-center justify-center px-4 py-10">
      <div className="bg-surface border border-rule rounded-card shadow-sm p-8 max-w-md w-full flex flex-col items-center text-center gap-3">
        <span className="h-14 w-14 rounded-full bg-navy/10 text-navy flex items-center justify-center">{icon}</span>
        <h1 className="font-display font-bold text-xl text-ink">{title}</h1>
        <p className="text-sm text-muted">{body}</p>
        {action}
      </div>
    </div>
  );
}

// Wraps practice, mock tests, placement and the tutor. The server enforces
// the same rules on every write; this just explains them instead of failing.
// It reads both the licence and what the learner owns: a purchase, an
// organization's credits or a grant from Spica staff open pages without a licence.
export function LicenseGate({ feature, children }: { feature: GatedFeature; children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const license = useMyLicense();
  const access = useMyAccessForGate();
  // The server said no to something on this page (outside what was bought).
  const [lockedAt, setLockedAt] = useState<string | null>(null);
  useEffect(() => {
    const on = () => setLockedAt(window.location.pathname);
    window.addEventListener(LOCKED_EVENT, on);
    return () => window.removeEventListener(LOCKED_EVENT, on);
  }, []);
  if (!license || access === undefined) return <>{children}</>;

  if (lockedAt === pathname) {
    return (
      <LockCard
        icon={<Sparkles size={26} strokeWidth={1.8} />}
        title={tr("Not included in your plan")}
        body={tr("Your preparation opens the Practice Modules question types of its own test. Full access opens every question type.")}
        action={
          <div className="flex flex-col items-center gap-2 mt-1">
            {license.individual && (
              <Link to={ROUTES.PLANS}>
                <Button>{t("plans.upgrade")}</Button>
              </Link>
            )}
            <button onClick={() => setLockedAt(null)} className="text-sm font-semibold text-navy hover:underline cursor-pointer">
              {tr("Back")}
            </button>
          </div>
        }
      />
    );
  }

  if (access && ownedOpens(access, feature)) return <>{children}</>;

  // An organization learner given something by credits, with no licence:
  // one placement test, as on the free plan (the server allows no retakes).
  const ownsSomething = !!access && access.owned.length > 0;
  if (license.required && !isLive(license) && !(feature === "placement" && ownsSomething)) {
    const expired = license.status === "expired";
    return (
      <div className="flex flex-col gap-4">
      {expired && <KeepGoingCard />}
      <LockCard
        icon={<Lock size={26} strokeWidth={1.8} />}
        title={expired ? tr("Your access has ended") : tr("Your access isn't active yet")}
        body={
          expired
            ? tr("Your license ended on {{formatShortDate}}. Ask your organization's admin or manager to extend it — your progress and reports are saved.", { formatShortDate: formatShortDate(license.accessEndsAt) })
            : tr("Your organization hasn't assigned you a license yet. Ask your admin or manager to assign one, then come back here.")
        }
        action={
          <Link to={ROUTES.PROGRESS} className="text-sm font-semibold text-navy hover:underline mt-1">
            {tr("View your progress")}</Link>
        }
      />
      </div>
    );
  }

  if (individualBlocked(license, feature)) {
    return (
      <LockCard
        icon={<Sparkles size={26} strokeWidth={1.8} />}
        title={t("plans.lockedTitle")}
        body={t(`plans.locked.${feature}`, { limit: license.freeTier?.practiceLimit ?? 3 })}
        action={
          <Link to={ROUTES.PLANS} className="mt-1">
            <Button>{t("plans.upgrade")}</Button>
          </Link>
        }
      />
    );
  }
  return <>{children}</>;
}

// Thin strip above learner pages: org grace/ending soon, or free-tier usage.
export function LicenseBanner() {
  const { t } = useTranslation();
  const license = useMyLicense();
  const access = useMyAccessForGate();
  const { pathname } = useLocation();
  if (!license) return null;
  // These pages show the fuller "keep going" card instead.
  if (([ROUTES.DASHBOARD, ROUTES.PRACTICE_TESTS, ROUTES.MOCK_EXAMS] as string[]).includes(pathname) && license.status !== "none") return null;

  // Free usage: only for learners on the free plan (not Full access, a pack or a preparation).
  if (license.individual && !isLive(license) && license.freeTier) {
    if (access === undefined || beyondFree(access)) return null;
    return (
      <div className="mb-4 flex items-center gap-2.5 text-sm text-ink bg-navy/5 border border-rule rounded-input px-3.5 py-2.5">
        <Sparkles size={16} className="shrink-0 text-navy" />
        <span className="flex-1">
          {t("plans.free.usage", { used: Math.min(license.freeTier.practiceUsed, license.freeTier.practiceLimit), limit: license.freeTier.practiceLimit })}
        </span>
        <Link to={ROUTES.PLANS} className="font-semibold text-navy hover:underline shrink-0">
          {t("plans.upgrade")}
        </Link>
      </div>
    );
  }

  if (!license.required && !license.individual) return null;
  const endsSoon =
    license.status === "active" && license.accessEndsAt && new Date(license.accessEndsAt).getTime() - Date.now() < 7 * 86400000;
  if (license.status !== "grace" && !endsSoon) return null;
  const who = license.individual ? tr("Renew from Plans") : tr("Ask your admin or manager");
  return (
    <div className="mb-4 flex items-center gap-2.5 text-sm text-navy-deep bg-warning/10 border border-warning/25 rounded-input px-3.5 py-2.5">
      <AlertTriangle size={16} className="shrink-0" />
      <span className="flex-1">
        {license.status === "grace"
          ? tr("Your access ended on {{formatShortDate}}. You can keep practicing until {{formatShortDate2}}. {{who}} to extend it.", { formatShortDate: formatShortDate(license.accessEndsAt), formatShortDate2: formatShortDate(license.graceEndsAt), who: who })
          : tr("Your access ends on {{formatShortDate}}. {{who}} if you need more time.", { formatShortDate: formatShortDate(license.accessEndsAt), who: who })}
      </span>
      {license.individual && (
        <Link to={ROUTES.PLANS} className="font-semibold hover:underline shrink-0">
          {t("plans.upgrade")}
        </Link>
      )}
    </div>
  );
}
