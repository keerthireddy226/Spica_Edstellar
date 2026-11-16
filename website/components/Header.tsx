import Link from "next/link";
import { app, nav } from "@/lib/site";

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

export function Header() {
  return (
    <header className="site-header">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="wrap bar">
        <Logo />
        <nav className="nav" aria-label="Main">
          {nav.map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
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
              <Link key={n.href} href={n.href}>
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
