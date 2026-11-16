"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Building2, ChevronDown, GraduationCap, Presentation, User, UserSearch } from "lucide-react";
import { app, nav } from "@/lib/site";

// The audiences in the "Who it's for" menu, with an icon each.
export const AUDIENCES = [
  { href: "/solutions/companies", label: "Companies", note: "Test, train and certify employees", icon: Building2 },
  { href: "/solutions/recruiters", label: "Recruiters", note: "Check applicants before interviews", icon: UserSearch },
  { href: "/solutions/universities", label: "Universities", note: "Admissions and placement", icon: GraduationCap },
  { href: "/solutions/training-providers", label: "Training providers", note: "Place and certify your learners", icon: Presentation },
  { href: "/solutions/individuals", label: "Individuals", note: "Know, improve and prove your level", icon: User },
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

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

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
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return (
    <header className="site-header" ref={header}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="wrap bar">
        <Logo />
        <nav className="nav" aria-label="Main">
          {nav.map((n) =>
            n.href === "/solutions" ? (
              <details key={n.href} className={`drop${isActive(path, n.href) ? " on" : ""}`}>
                <summary aria-current={isActive(path, n.href) ? "page" : undefined}>
                  {n.label} <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <div className="drop-menu">
                  {AUDIENCES.map((a) => {
                    const Icon = a.icon;
                    return (
                      <Link key={a.href} href={a.href} aria-current={isActive(path, a.href) ? "page" : undefined}>
                        <span className="drop-icon">
                          <Icon size={18} />
                        </span>
                        <span>
                          <b>{a.label}</b>
                          <small>{a.note}</small>
                        </span>
                      </Link>
                    );
                  })}
                  <Link href="/solutions" className="drop-all">
                    Compare all audiences →
                  </Link>
                </div>
              </details>
            ) : (
              <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}>
                {n.label}
              </Link>
            ),
          )}
        </nav>
        <div className="bar-actions">
          <details className="signin">
            <summary>Sign in</summary>
            <div className="signin-menu">
              <SignInLinks />
            </div>
          </details>
          <a className="btn primary small" href="/#demo">
            Book a demo
          </a>
        </div>
        <details className="menu-toggle">
          <summary aria-label="Menu">Menu</summary>
          <div className="mobile-menu">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
            <SignInLinks />
            <a className="btn primary" href="/#demo">
              Book a demo
            </a>
            <a className="btn ghost" href={app.signUp}>
              Start free
            </a>
          </div>
        </details>
      </div>
    </header>
  );
}
