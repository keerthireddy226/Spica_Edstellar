import { FileText } from "lucide-react";
import { PageHero } from "./PageHero";

// A legal or policy page: effective date, contents list and numbered sections.
export type Section = { id: string; title: string; body: React.ReactNode };

export function LegalDoc({ title, lead, updated, sections, note }: { title: string; lead: string; updated: string; sections: Section[]; note?: React.ReactNode }) {
  return (
    <>
      <PageHero crumbs={[{ href: "/legal", label: "Legal" }, { label: title }]} eyebrow="Legal" icon={<FileText size={16} />} title={title} lead={lead} />
      <section className="section">
        <div className="wrap legal-doc">
          <aside className="legal-toc" aria-label="Contents">
            <p className="legal-updated">Last updated: {updated}</p>
            <p className="legal-toc-title">Contents</p>
            <ol>
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.title}</a>
                </li>
              ))}
            </ol>
          </aside>
          <article className="legal-body">
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
