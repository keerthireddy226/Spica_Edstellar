"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Fades sections in as they scroll into view, and counts numbers up once.
// Watches every page (also after moving between pages without a reload) and
// any section added later. Respects "reduce motion"; without JavaScript
// everything is simply visible.
export function Reveal() {
  const path = usePathname();
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    if (reduce || !("IntersectionObserver" in window)) {
      root.classList.remove("h-anim");
      return;
    }
    root.classList.add("h-anim");
    const show = (el: HTMLElement) => {
      el.classList.add("h-in");
      const to = el.dataset.count;
      if (to && !el.dataset.counted) {
        el.dataset.counted = "1";
        const end = Number(to);
        const start = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - start) / 900);
          el.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          show(e.target as HTMLElement);
          io.unobserve(e.target);
        }
      },
      // Any part in view counts, so very tall sections show too.
      { threshold: 0, rootMargin: "0px 0px -8% 0px" },
    );
    const watch = () =>
      document.querySelectorAll<HTMLElement>("[data-reveal]:not(.h-in), [data-count]:not(.h-in)").forEach((el) => {
        // Already on screen (or above it): show at once.
        if (el.getBoundingClientRect().top < window.innerHeight) show(el);
        else io.observe(el);
      });
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    // Safety net: nothing stays hidden for long.
    const t = setTimeout(() => document.querySelectorAll<HTMLElement>("[data-reveal]:not(.h-in)").forEach((el) => { if (el.getBoundingClientRect().top < window.innerHeight * 1.5) show(el); }), 1500);
    return () => {
      io.disconnect();
      mo.disconnect();
      clearTimeout(t);
    };
  }, [path]);
  return null;
}
