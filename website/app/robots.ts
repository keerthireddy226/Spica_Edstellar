import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

// Search engines may index the site only when it is published on its real
// address (NEXT_PUBLIC_SITE_URL set and NEXT_PUBLIC_ALLOW_INDEXING=true);
// previews stay out of search results.
export default function robots(): MetadataRoute.Robots {
  const allow = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
  return allow ? { rules: { userAgent: "*", allow: "/" }, sitemap: `${BASE}/sitemap.xml` } : { rules: { userAgent: "*", disallow: "/" } };
}
