"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  Accessibility,
  BarChart3,
  BookOpenCheck,
  Bot,
  Building2,
  ChevronDown,
  Code2,
  FileBarChart,
  GraduationCap,
  HelpCircle,
  Layers,
  LifeBuoy,
  ListChecks,
  Presentation,
  QrCode,
  Rocket,
  Scale,
  ShieldCheck,
  User,
  UserSearch,
} from "lucide-react";
import { app } from "@/lib/site";
import { TESTS } from "@/lib/tests";
import { TEST_LOOK } from "@/components/page/looks";

type Item = { href: string; label: string; note: string; icon: React.ElementType };
type Menu = { label: string; href: string; items: Item[]; more?: { href: string; label: string }; wide?: boolean };

// The audiences, also used on the Solutions pages.
export const AUDIENCES: Item[] = [
  { href: "/solutions/companies", label: "Companies", note: "Test, train and certify employees", icon: Building2 },
  { href: "/solutions/recruiters", label: "Recruiters", note: "Check applicants before interviews", icon: UserSearch },
  { href: "/solutions/universities", label: "Universities", note: "Admissions and placement", icon: GraduationCap },
  { href: "/solutions/training-providers", label: "Training providers", note: "Place and certify your learners", icon: Presentation },
  { href: "/solutions/individuals", label: "Individuals", note: "Know, improve and prove your level", icon: User },
];

const MENUS: Menu[] = [
  {
    label: "Tests",
    href: "/tests",
    wide: true,
    items: [
      ...TESTS.map((t) => ({ href: `/tests/${t.slug}`, label: t.name, note: t.short, icon: TEST_LOOK[t.slug]?.icon ?? ListChecks })),
      { href: "/how-to-take-a-test", label: "How to take a test", note: "From signing up to your certificate, step by step", icon: Rocket },
    ],
    more: { href: "/tests", label: "Compare all tests →" },
  },
  {
    label: "Levels",
    href: "/levels",
    items: [
      { href: "/levels", label: "English levels A1–C2", note: "What each level means, skill by skill", icon: Layers },
      { href: "/understanding-your-score", label: "Understanding your score", note: "How to read a Spica score report", icon: BarChart3 },
      { href: app.signUp, label: "Free level test", note: "Find your level in each skill, free", icon: BookOpenCheck },
    ],
  },
  {
    label: "Solutions",
    href: "/solutions",
    items: [...AUDIENCES, { href: "/certificate-check", label: "Verify a certificate", note: "For employers and universities", icon: QrCode }],
    more: { href: "/solutions", label: "Compare all solutions →" },
  },
  {
    label: "Resources",
    href: "/help",
    items: [
      { href: "/help", label: "Help centre", note: "Guides for learners and organisations", icon: LifeBuoy },
      { href: "/faq", label: "FAQ", note: "Quick answers to common questions", icon: HelpCircle },
      { href: "/demo", label: "Sample reports", note: "Score reports and a certificate", icon: FileBarChart },
      { href: "/test-quality", label: "Test quality and fairness", note: "How the tests are built and checked", icon: Scale },
      { href: "/how-ai-is-used", label: "How AI is used", note: "AI scores, people decide", icon: Bot },
      { href: "/security", label: "Security and trust", note: "How data is protected", icon: ShieldCheck },
      { href: "/developers", label: "Developers", note: "API, webhooks and company sign-in", icon: Code2 },
      { href: "/legal/accessibility", label: "Accessibility", note: "Using Spica with a disability", icon: Accessibility },
    ],
  },
];

export function Logo() {
  return (
    <Link className="logo" href="/" aria-label="Spica by Edstellar, home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 6 2 12.5 16 19l14-6.5L16 6Z" fill="#fff" />
        <path d="M8 15.8v5.4c0 1.8 3.6 3.8 8 3.8s8-2 8-3.8v-5.4L16 19.5 8 15.8Z" fill="#f3d6c7" />
        <path d="M27 13.6v6.2" stroke="#f3d6c7" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <b>Spica</b>
      <i>by Edstellar</i>
    </Link>
  );
}

function SignInLinks() {
  return (
    <>
      <a href={app.learnerSignIn}>
        Learners and test takers<small>Practice, tests and certificates</small>
      </a>
      <a href={app.orgSignIn}>
        Organisations and recruiters<small>Admin and recruitment console</small>
      </a>
      <a href={app.managerSignIn}>
        Managers<small>Your teams and batches</small>
      </a>
    </>
  );
}

const isActive = (path: string, href: string) => !href.startsWith("http") && (path === href || path.startsWith(href + "/"));
const menuActive = (path: string, m: Menu) => isActive(path, m.href) || m.items.some((i) => isActive(path, i.href));

function MenuLink({ item, path }: { item: Item; path: string }) {
  const Icon = item.icon;
  const body = (
    <>
      <span className="drop-icon">
        <Icon size={18} />
      </span>
      <span>
        <b>{item.label}</b>
        <small>{item.note}</small>
      </span>
    </>
  );
  return item.href.startsWith("http") ? (
    <a href={item.href}>{body}</a>
  ) : (
    <Link href={item.href} aria-current={isActive(path, item.href) ? "page" : undefined}>
      {body}
    </Link>
  );
}

export function Header() {
  const path = usePathname() || "/";
  const header = useRef<HTMLElement>(null);

  // Close any open menu after moving to another page, and when clicking elsewhere.
  useEffect(() => {
    header.current?.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
  }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      header.current?.querySelectorAll("details[open]").forEach((d) => {
        if (!d.contains(e.target as Node)) d.removeAttribute("open");
      });
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") header.current?.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  return (
    <header className="site-header" ref={header}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="wrap bar">
        <Logo />
        <nav className="nav" aria-label="Main">
          {MENUS.map((m) => {
            const on = menuActive(path, m);
            return (
              <details key={m.label} className={`drop${on ? " on" : ""}`}>
                <summary aria-current={on ? "page" : undefined}>
                  {m.label} <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <div className={`drop-menu${m.wide ? " wide" : ""}`}>
                  <div className="drop-items">
                    {m.items.map((i) => (
                      <MenuLink key={i.href + i.label} item={i} path={path} />
                    ))}
                  </div>
                  {m.more && (
                    <Link href={m.more.href} className="drop-all">
                      {m.more.label}
                    </Link>
                  )}
                </div>
              </details>
            );
          })}
          <Link href="/pricing" aria-current={isActive(path, "/pricing") ? "page" : undefined}>
            Pricing
          </Link>
        </nav>
        <div className="bar-actions">
          <details className="signin">
            <summary>Sign in</summary>
            <div className="signin-menu">
              <SignInLinks />
            </div>
          </details>
          <a className="btn ghost small" href={app.signUp}>
            Free level test
          </a>
          <a className="btn primary small" href="/#demo">
            Book a demo
          </a>
        </div>
        <details className="menu-toggle">
          <summary aria-label="Menu">Menu</summary>
          <div className="mobile-menu">
            {MENUS.map((m) => (
              <details key={m.label} className="mm-group" open={menuActive(path, m)}>
                <summary>{m.label}</summary>
                {m.items.map((i) =>
                  i.href.startsWith("http") ? (
                    <a key={i.href + i.label} href={i.href}>
                      {i.label}
                    </a>
                  ) : (
                    <Link key={i.href + i.label} href={i.href} aria-current={isActive(path, i.href) ? "page" : undefined}>
                      {i.label}
                    </Link>
                  ),
                )}
              </details>
            ))}
            <Link href="/pricing" className="mm-top" aria-current={isActive(path, "/pricing") ? "page" : undefined}>
              Pricing
            </Link>
            <p className="mm-label">Sign in</p>
            <SignInLinks />
            <a className="btn primary" href="/#demo">
              Book a demo
            </a>
            <a className="btn ghost" href={app.signUp}>
              Free level test
            </a>
          </div>
        </details>
      </div>
    </header>
  );
}
