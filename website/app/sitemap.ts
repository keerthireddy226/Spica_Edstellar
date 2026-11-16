import type { MetadataRoute } from "next";
import { PAGE_GROUPS } from "@/lib/pages";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

export default function sitemap(): MetadataRoute.Sitemap {
  const all = [...new Set(PAGE_GROUPS.flatMap((g) => g.pages.map((p) => p.href))), "/site-map"];
  return all.map((p) => ({ url: `${BASE}${p === "/" ? "" : p}`, changeFrequency: "monthly" as const, priority: p === "/" ? 1 : p.startsWith("/legal") ? 0.4 : 0.7 }));
}
