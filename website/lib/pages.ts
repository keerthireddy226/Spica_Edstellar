// Every public page, grouped. Used by sitemap.xml and the Sitemap page.
import { TESTS } from "./tests";
import { SOLUTIONS } from "./solutions";
import { LEVELS } from "./levels";

export const PAGE_GROUPS: { title: string; pages: { href: string; label: string }[] }[] = [
  { title: "Spica", pages: [{ href: "/", label: "Home" }, { href: "/pricing", label: "Pricing" }, { href: "/demo", label: "Demo and sample reports" }, { href: "/about", label: "About" }, { href: "/contact", label: "Contact" }] },
  {
    title: "Tests",
    pages: [{ href: "/tests", label: "All tests" }, ...TESTS.map((t) => ({ href: `/tests/${t.slug}`, label: t.name })), { href: "/how-to-take-a-test", label: "How to take a test" }],
  },
  {
    title: "Levels",
    pages: [{ href: "/levels", label: "English levels" }, ...LEVELS.map((l) => ({ href: `/levels/${l.slug}`, label: `${l.code} · ${l.name}` })), { href: "/understanding-your-score", label: "Understanding your score" }],
  },
  {
    title: "Solutions",
    pages: [{ href: "/solutions", label: "All solutions" }, ...SOLUTIONS.map((s) => ({ href: `/solutions/${s.slug}`, label: s.name })), { href: "/certificate-check", label: "Verify a certificate" }],
  },
  {
    title: "Resources",
    pages: [
      { href: "/help", label: "Help centre" },
      { href: "/faq", label: "FAQ" },
      { href: "/test-quality", label: "Test quality and fairness" },
      { href: "/how-ai-is-used", label: "How AI is used" },
      { href: "/security", label: "Security and trust" },
      { href: "/developers", label: "Developers" },
    ],
  },
  {
    title: "Legal",
    pages: [
      { href: "/legal", label: "All legal documents" },
      { href: "/legal/terms", label: "Terms and Conditions" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/refunds", label: "Refunds and cancellation" },
      { href: "/legal/test-rules", label: "Test rules" },
      { href: "/legal/certificates", label: "Certificate policy" },
      { href: "/legal/biometric-data", label: "Biometric data policy" },
      { href: "/legal/cookies", label: "Cookie notice" },
      { href: "/legal/accessibility", label: "Accessibility" },
      { href: "/legal/grievance", label: "Grievance redressal" },
    ],
  },
];
