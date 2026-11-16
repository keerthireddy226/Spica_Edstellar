import Link from "next/link";
import { company, footer } from "@/lib/site";
import { Logo } from "./Header";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Logo />
            <p className="muted" style={{ marginTop: 12, maxWidth: 300 }}>
              Know your English level. Improve it. Prove it. Practice, proctored tests and certificates anyone can check.
            </p>
          </div>
          {footer.map((col) => (
            <div key={col.title}>
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="footer-base">
          <span>
            © {new Date().getFullYear()} {company.legalName}. {company.address}.
          </span>
          <span>
            <Link href="/legal/terms">Terms</Link> · <Link href="/legal/privacy">Privacy</Link> · <Link href="/security">Security</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
