import Link from "next/link";
import { ChevronRight } from "lucide-react";

// The top of every inner page: where you are (breadcrumb), the page's own
// colour and icon, the headline, and a picture of what the page is about.
export type Tone = "clay" | "moss" | "sky" | "gold" | "plum";

export function PageHero({
  crumbs,
  eyebrow,
  icon,
  title,
  lead,
  tone = "clay",
  actions,
  visual,
  top,
}: {
  crumbs: { href?: string; label: string }[];
  eyebrow: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  lead: React.ReactNode;
  tone?: Tone;
  actions?: React.ReactNode;
  visual?: React.ReactNode;
  /** Align the text to the top, for a tall picture such as a form. */
  top?: boolean;
}) {
  return (
    <section className={`ph tone-${tone}`}>
      <div className="ph-glow" aria-hidden="true" />
      <div className={`wrap ph-grid${visual ? "" : " solo"}${top ? " top" : ""}`}>
        <div className="ph-copy">
          <nav className="ph-crumbs" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            {crumbs.map((c, i) => (
              <span key={c.label}>
                <ChevronRight size={14} aria-hidden="true" />
                {c.href && i < crumbs.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
              </span>
            ))}
          </nav>
          <p className="ph-eyebrow">
            <span className="ph-icon" aria-hidden="true">
              {icon}
            </span>
            {eyebrow}
          </p>
          <h1>{title}</h1>
          <p className="lead">{lead}</p>
          {actions && <div className="ph-actions">{actions}</div>}
        </div>
        {visual && <div className="ph-visual">{visual}</div>}
      </div>
    </section>
  );
}
