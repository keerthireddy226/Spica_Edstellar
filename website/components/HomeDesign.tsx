"use client";

import Script from "next/script";
import { useEffect } from "react";
import { HOME_MARKUP } from "@/lib/homeMarkup";

declare global {
  interface Window {
    __spicaHome?: () => void;
    SPICA_FORM_ENDPOINT?: string;
  }
}

// The Spica product page from the design (spica 2.html): its markup, scoped
// styles (app/home.css) and its script (public/home.js), which runs once per
// visit. The demo form posts to NEXT_PUBLIC_FORM_ENDPOINT (Edstellar's form system).
export function HomeDesign() {
  useEffect(() => {
    window.SPICA_FORM_ENDPOINT = process.env.NEXT_PUBLIC_FORM_ENDPOINT || "";
    window.__spicaHome?.();
  }, []);
  return (
    <>
      <div className="sd" dangerouslySetInnerHTML={{ __html: HOME_MARKUP }} />
      <Script src="/home.js" strategy="afterInteractive" onReady={() => window.__spicaHome?.()} />
    </>
  );
}
