import { FileText } from "lucide-react";
import { PageHero } from "./PageHero";

// A legal or policy page: last-updated date and numbered sections (no contents list).
export type Section = { id: string; title: string; body: React.ReactNode };

export function LegalDoc({ title, lead, updated, sections, note }: { title: string; lead: string; updated: string; sections: Section[]; note?: React.ReactNode }) {
  return (
    <>
      <PageHero crumbs={[{ href: "/legal", label: "Legal" }, { label: title }]} eyebrow="Legal" icon={<FileText size={16} />} title={title} lead={lead} />
      <section className="section">
        <div className="wrap legal-doc">
          <article className="legal-body">
            <p className="legal-updated">Last updated: {updated}</p>
            {note && <div className="legal-note">{note}</div>}
            {sections.map((s, i) => (
              <section key={s.id} id={s.id}>
                <h2>
                  {i + 1}. {s.title}
                </h2>
                {s.body}
              </section>
            ))}
          </article>
        </div>
      </section>
    </>
  );
}
