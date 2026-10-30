import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PRIVACY_NOTICE_FILE, ROUTES } from "@/constants/routes";

// One role's Privacy Notice (or the DPA) in the app's own layout. The text
// comes from the notice files in public/legal, which are also shared as
// documents, so the app and the documents always say the same thing.
interface Notice {
  eyebrow: string;
  title: string;
  meta: string;
  inShort: { title: string; text: string }[];
  body: string;
}

function parse(html: string): Notice {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.body;
  const take = (sel: string) => {
    const el = root.querySelector(sel);
    const text = el?.textContent?.trim() ?? "";
    el?.remove();
    return text;
  };
  const eyebrow = take(".eyebrow");
  // A notice reads as a notice: "Privacy Notice", not which kind of user it is for.
  const fullTitle = take("h1");
  const title = fullTitle.startsWith("Privacy Notice") ? "Privacy Notice" : fullTitle;
  const meta = take(".meta");
  const cards = root.querySelector(".cards");
  const inShort = [...(cards?.querySelectorAll(".card") ?? [])].map((c) => {
    const b = c.querySelector("b");
    const t = b?.textContent?.trim() ?? "";
    b?.remove();
    return { title: t, text: c.textContent?.trim() ?? "" };
  });
  cards?.remove();
  root.querySelector(".banner")?.remove();
  // No contents line in the app: the sections follow straight on.
  root.querySelector("nav.toc")?.remove();
  [...root.querySelectorAll("p")].find((el) => el.textContent?.trim().startsWith("This notice is for"))?.remove();
  // Links between notices open the in-app page.
  root.querySelectorAll<HTMLAnchorElement>('a[href^="/legal/"]').forEach((a) => {
    const file = a.getAttribute("href")!.replace("/legal/", "");
    const key = Object.entries(PRIVACY_NOTICE_FILE).find(([, f]) => f === file)?.[0];
    if (key) a.setAttribute("href", `/privacy/${key}`);
  });
  return { eyebrow, title, meta, inShort, body: root.innerHTML };
}

export function PrivacyNoticeDoc() {
  const { audience = "free" } = useParams();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const file = PRIVACY_NOTICE_FILE[audience as keyof typeof PRIVACY_NOTICE_FILE];
    if (!file) return setFailed(true);
    setNotice(null);
    fetch(`/legal/${file}`)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((h) => setNotice(parse(h)))
      .catch(() => setFailed(true));
  }, [audience]);

  return (
    <div className="min-h-screen bg-paper-warm px-4 py-10">
      <article className="mx-auto max-w-3xl bg-surface border border-rule rounded-card shadow-sm p-6 md:p-10 flex flex-col gap-7">
        {failed ? (
          <p className="text-sm text-error">
            This notice could not be loaded.{" "}
            <Link to={ROUTES.PRIVACY} className="underline">
              See all Privacy Notices
            </Link>
          </p>
        ) : !notice ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <header className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{notice.eyebrow}</p>
              <h1 className="font-display font-bold text-2xl text-ink">{notice.title}</h1>
              <p className="text-sm text-muted">{notice.meta}</p>
            </header>
            {notice.inShort.length > 0 && (
              <div className="rounded-input bg-paper-warm p-4 flex flex-col gap-1.5 text-sm text-ink">
                <p className="font-semibold">In short</p>
                <ul className="list-disc pl-5 flex flex-col gap-1">
                  {notice.inShort.map((s) => (
                    <li key={s.title}>
                      <b>{s.title}:</b> {s.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div
              className="flex flex-col gap-2 text-sm text-ink leading-relaxed [&_h2]:font-display [&_h2]:font-bold [&_h2]:text-lg [&_h2]:text-ink [&_h2]:mt-5 [&_h3]:font-semibold [&_h3]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_a]:text-navy-deep [&_nav]:flex [&_nav]:flex-wrap [&_nav]:gap-x-4 [&_nav]:gap-y-1 [&_nav]:text-sm [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-rule [&_th]:bg-paper-warm [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:border-rule [&_td]:p-2 [&_td]:align-top [&_.wrap]:overflow-x-auto [&_.note]:text-xs [&_.note]:text-muted [&_footer]:text-sm [&_footer]:text-muted [&_footer]:border-t [&_footer]:border-rule [&_footer]:pt-4 [&_footer]:mt-4"
              dangerouslySetInnerHTML={{ __html: notice.body }}
            />
          </>
        )}
      </article>
    </div>
  );
}
