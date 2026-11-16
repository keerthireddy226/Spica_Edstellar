import type { Metadata } from "next";
import Link from "next/link";
import { Map } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";
import { PAGE_GROUPS } from "@/lib/pages";

export const metadata: Metadata = { title: "Sitemap", description: "Every page on the Spica website." };

export default function SiteMapPage() {
  return (
    <>
      <PageHero crumbs={[{ label: "Sitemap" }]} eyebrow="Sitemap" icon={<Map size={16} />} title="Every page, in one place" lead="Find any page on the Spica website." />
      <section className="section">
        <div className="wrap sitemap-grid">
          {PAGE_GROUPS.map((g) => (
            <div key={g.title}>
              <h2 className="footer-title">{g.title}</h2>
              <ul>
                {g.pages.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href}>{p.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
