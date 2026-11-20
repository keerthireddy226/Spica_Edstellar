// Each page gets its own browser title from its main heading ("My reports ·
// Spica"), so screen readers, tabs and history name the page (WCAG 2.4.2).
// Pages set no title themselves; the heading is read after each render.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    let last = "";
    const update = () => {
      const h1 = document.querySelector("main h1, h1")?.textContent?.trim().replace(/\s+/g, " ");
      const title = h1 && h1 !== "Spica" ? `${h1.slice(0, 70)} · Spica` : "Spica";
      if (title !== last && !document.title.startsWith("Spica score report")) {
        document.title = title;
        last = title;
      }
    };
    update();
    const observer = new MutationObserver(() => update());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname]);
}
