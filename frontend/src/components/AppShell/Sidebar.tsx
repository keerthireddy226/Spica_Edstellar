import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { GraduationCap, LayoutDashboard, BookOpen, ChevronDown, Headphones, Mic, PenLine, MessageCircle, ClipboardList, User, Map, BarChart3, Sparkles, Timer, FileText } from "lucide-react";
import { useMyLicense } from "@/components/licenses/LicenseGate";
import { ROUTES } from "@/constants/routes";
import { useHasPlacement } from "@/hooks/useHasPlacement";
import type { SkillTag } from "@/api/testSession";

import { tr } from "@/i18n/tr";
const MODULE_SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];
const MODULE_SKILL_ICONS: Record<SkillTag, LucideIcon> = {
  listening: Headphones,
  speaking: Mic,
  reading: BookOpen,
  writing: PenLine,
};

function navClasses(isActive: boolean) {
  return [
    "flex items-center gap-3 rounded-input px-3 py-2.5 text-sm font-medium transition-colors",
    isActive ? "bg-navy-soft text-lime" : "text-lime/60 hover:bg-white/5 hover:text-lime/90",
  ].join(" ");
}

const lockedClasses = "flex items-center gap-3 rounded-input px-3 py-2.5 text-sm font-medium text-lime/30 cursor-not-allowed";

function NavEntry({
  to,
  icon: Icon,
  label,
  isActive,
  locked,
  onClick,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  if (locked) {
    return (
      <span className={lockedClasses}>
        <Icon size={22} strokeWidth={1.8} />
        {label}
      </span>
    );
  }
  return (
    <Link to={to} onClick={onClick} className={navClasses(isActive)}>
      <Icon size={22} strokeWidth={1.8} />
      {label}
    </Link>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const myLicense = useMyLicense();
  const [searchParams] = useSearchParams();
  const hasPlacement = useHasPlacement();
  // The organization may have switched Modules off for its learners.
  const modulesOn = useModulesEnabled();
  const locked = hasPlacement !== true;
  const onModulesPage = location.pathname === ROUTES.MODULES;
  const [modulesExpanded, setModulesExpanded] = useState(onModulesPage);

  // Re-expand whenever navigation lands on the Modules page (e.g. via a
  // dashboard card click) — a plain mount-time useState default only ever
  // fires once and misses every later navigation into this section.
  useEffect(() => {
    if (onModulesPage) setModulesExpanded(true);
  }, [onModulesPage]);

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
          <Link to={ROUTES.ROADMAP} onClick={onClose} className={navClasses(location.pathname === ROUTES.ROADMAP)}>
            <Map size={22} strokeWidth={1.8} />
            {t("nav.roadmap")}
          </Link>

          <NavEntry
            to={ROUTES.DASHBOARD}
            icon={LayoutDashboard}
            label={t("nav.overview")}
            isActive={location.pathname === ROUTES.DASHBOARD}
            locked={locked}
            onClick={onClose}
          />
          <NavEntry
            to={ROUTES.PROGRESS}
            icon={BarChart3}
            label={t("nav.progress")}
            isActive={location.pathname === ROUTES.PROGRESS}
            locked={locked}
            onClick={onClose}
          />
          {!modulesOn ? null : locked ? (
            <span className={lockedClasses}>
              <BookOpen size={22} strokeWidth={1.8} />
              {t("nav.modules")}
            </span>
          ) : (
            <>
              <button
                onClick={() => setModulesExpanded((v) => !v)}
                className="flex items-center gap-3 rounded-input px-3 py-2.5 text-sm font-medium text-lime/60 hover:bg-white/5 hover:text-lime/90 transition-colors cursor-pointer"
              >
                <BookOpen size={22} strokeWidth={1.8} />
                <span className="flex-1 text-left">{t("nav.modules")}</span>
                <ChevronDown size={20} className={`transition-transform ${modulesExpanded ? "rotate-180" : ""}`} />
              </button>

              {modulesExpanded && (
                <div className="flex flex-col gap-1 pl-4">
                  {MODULE_SKILLS.map((skill) => (
                    <NavEntry
                      key={skill}
                      to={`${ROUTES.MODULES}?skill=${skill}`}
                      icon={MODULE_SKILL_ICONS[skill]}
                      label={t(`skills.${skill}`)}
                      isActive={onModulesPage && searchParams.get("skill") === skill}
                      locked={false}
                      onClick={onClose}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          <NavEntry
            to={ROUTES.PRACTICE_TESTS}
            icon={ClipboardList}
            label={t("nav.practiceTests")}
            isActive={location.pathname.startsWith(ROUTES.PRACTICE_TESTS) && !location.pathname.startsWith("/practice-tests/report/")}
            locked={locked}
            onClick={onClose}
          />
          <NavEntry
            to={ROUTES.MOCK_EXAMS}
            icon={Timer}
            label={tr("Mock Exams")}
            isActive={location.pathname.startsWith(ROUTES.MOCK_EXAMS)}
            locked={locked}
            onClick={onClose}
          />
          <NavEntry
            to={ROUTES.MY_REPORTS}
            icon={FileText}
            label={tr("My reports")}
            isActive={location.pathname.startsWith(ROUTES.MY_REPORTS) || location.pathname.startsWith("/practice-tests/report/")}
            locked={locked}
            onClick={onClose}
          />
          <NavEntry
            to={ROUTES.TUTOR}
            icon={MessageCircle}
            label={t("nav.tutor")}
            isActive={location.pathname === ROUTES.TUTOR}
            locked={locked}
            onClick={onClose}
          />
          {myLicense?.individual && myLicense.status !== "active" && myLicense.status !== "grace" && (
            <NavEntry
              to={ROUTES.PLANS}
              icon={Sparkles}
              label={t("plans.title")}
              isActive={location.pathname === ROUTES.PLANS}
              locked={locked}
              onClick={onClose}
            />
          )}
          <NavEntry
            to={ROUTES.PROFILE}
            icon={User}
            label={t("nav.profile")}
            isActive={location.pathname === ROUTES.PROFILE}
            locked={locked}
            onClick={onClose}
          />
        </nav>
      </aside>
    </>
  );
}
