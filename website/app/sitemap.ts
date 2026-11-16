import type { MetadataRoute } from "next";
import { TESTS } from "@/lib/tests";
import { SOLUTIONS } from "@/lib/solutions";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/tests", "/solutions", "/pricing", "/demo", "/certificate-check", "/security", "/about", "/contact", "/help", "/developers", "/legal"];
  return [
    ...pages.map((p) => ({ url: `${BASE}${p}`, changeFrequency: "monthly" as const, priority: p === "" ? 1 : 0.7 })),
    ...TESTS.map((t) => ({ url: `${BASE}/tests/${t.slug}`, changeFrequency: "monthly" as const, priority: 0.8 })),
    ...SOLUTIONS.map((s) => ({ url: `${BASE}/solutions/${s.slug}`, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
