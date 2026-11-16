"use client";

import { useEffect } from "react";

// Fades sections in as they scroll into view, and counts numbers up once.
// Respects "reduce motion"; without JavaScript everything is simply visible.
export function Reveal() {
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    if (reduce || !("IntersectionObserver" in window)) return;
    root.classList.add("h-anim");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.classList.add("h-in");
          const to = el.dataset.count;
          if (to) {
            const end = Number(to);
            const start = performance.now();
            const tick = (t: number) => {
              const p = Math.min(1, (t - start) / 900);
              el.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3))));
              if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
          io.unobserve(el);
        }
      },
      { threshold: 0.15 },
    );
    document.querySelectorAll("[data-reveal], [data-count]").forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove("h-anim");
    };
  }, []);
  return null;
}
