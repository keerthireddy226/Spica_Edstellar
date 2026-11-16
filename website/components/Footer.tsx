import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { app, company, footer } from "@/lib/site";
import { Logo } from "./Header";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Logo />
            <p className="muted">English tests, practice and certificates anyone can check, for organisations and individuals.</p>
            <p className="footer-help">
              <Mail size={15} aria-hidden="true" /> Need help? Email us at <b>{company.supportEmail}</b>
            </p>
            <a className="btn primary small" href={app.signUp}>
              Start free <ArrowRight size={15} aria-hidden="true" />
            </a>
          </div>
          {footer.map((col) => (
            <div key={col.title}>
              <h2 className="footer-title">{col.title}</h2>
              <ul>
                {col.links.map((l) => (
                  <li key={l.href + l.label}>{l.href.startsWith("http") ? <a href={l.href}>{l.label}</a> : <Link href={l.href}>{l.label}</Link>}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="footer-base">
          <span>
            © {new Date().getFullYear()} {company.legalName}. {company.address}. Spica is a product of Edstellar.
          </span>
          <span className="footer-base-links">
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/cookies">Cookies</Link>
            <Link href="/legal/accessibility">Accessibility</Link>
            <Link href="/site-map">Sitemap</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
