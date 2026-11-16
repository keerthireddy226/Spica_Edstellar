"use client";

import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { app } from "@/lib/site";

// A closing call to action at the foot of every inner page. Home and the
// Demo page have their own demo form, so they skip it.
export function CtaBand() {
  const path = usePathname() || "/";
  if (path === "/" || path === "/demo") return null;
  return (
    <section className="cta-band">
      <div className="wrap cta-inner">
        <div>
          <h2>See Spica with your own people</h2>
          <p>A walkthrough with an Edstellar specialist: the tests, the reports and the certificate, shown for the way you would use them.</p>
        </div>
        <div className="cta-actions">
          <a className="btn light" href="/#demo">
            Book a demo <ArrowRight size={17} aria-hidden="true" />
          </a>
          <a className="btn outline-light" href={app.signUp}>
            Start free
          </a>
        </div>
      </div>
    </section>
  );
}
