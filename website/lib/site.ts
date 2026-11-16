// Everything the website links to or names in one place. Items in [brackets]
// are placeholders until the business decides them (company details, emails).

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://spica-edstellar-kohl.vercel.app";

export const app = {
  signUp: `${APP_URL}/signup`,
  learnerSignIn: `${APP_URL}/learner/login`,
  orgSignIn: `${APP_URL}/orgadmin/login`, // Org Admins and recruiters
  managerSignIn: `${APP_URL}/manager/login`,
  certificateCheck: (code: string) => `${APP_URL}/certificate/${encodeURIComponent(code.trim())}`,
  sampleCertificate: `${APP_URL}/certificate/SAMPLE`,
  sampleReport: (test = "fourSkills") => `${APP_URL}/sample-report?test=${test}`,
  plans: `${APP_URL}/spica-plans`,
};

export const company = {
  brand: "Spica",
  by: "by Edstellar",
  legalName: "[Edstellar registered company name]",
  address: "[Registered address]",
  supportEmail: "[support email]",
  salesEmail: "[sales email]",
  privacyEmail: "[privacy email]",
  securityEmail: "[security email]",
};

// Main menu. Each entry opens a drop-down (built in components/Header.tsx),
// except Pricing.
export const nav = [
  { href: "/tests", label: "Tests" },
  { href: "/levels", label: "Levels" },
  { href: "/solutions", label: "Solutions" },
  { href: "/help", label: "Resources" },
  { href: "/pricing", label: "Pricing" },
];

export const footer: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Tests",
    links: [
      { href: "/tests/english-4-skills-essentials", label: "English 4 Skills Essentials" },
      { href: "/tests/english-placement", label: "English Placement" },
      { href: "/tests/professional-english", label: "Professional English" },
      { href: "/tests/speaking-and-listening", label: "Speaking & Listening" },
      { href: "/tests/writing", label: "English Writing" },
      { href: "/tests/level-tests", label: "Level Tests (A1–C2)" },
      { href: "/tests#compare", label: "Compare tests" },
    ],
  },
  {
    title: "Learners",
    links: [
      { href: app.signUp, label: "Free level test" },
      { href: "/levels", label: "English levels" },
      { href: "/how-to-take-a-test", label: "How to take a test" },
      { href: "/understanding-your-score", label: "Understanding your score" },
      { href: "/solutions/individuals", label: "Spica for individuals" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Organisations",
    links: [
      { href: "/solutions/companies", label: "Companies" },
      { href: "/solutions/recruiters", label: "Recruiters" },
      { href: "/solutions/universities", label: "Universities" },
      { href: "/solutions/training-providers", label: "Training providers" },
      { href: "/certificate-check", label: "Verify a certificate" },
      { href: "/developers", label: "Developers (API)" },
      { href: "/demo", label: "Book a demo" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/help", label: "Help centre" },
      { href: "/demo", label: "Sample reports" },
      { href: "/test-quality", label: "Test quality and fairness" },
      { href: "/how-ai-is-used", label: "How AI is used" },
      { href: "/security", label: "Security and trust" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/pricing", label: "Pricing" },
      { href: "/contact", label: "Contact" },
      { href: "/site-map", label: "Sitemap" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms and Conditions" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/refunds", label: "Refunds and cancellation" },
      { href: "/legal/test-rules", label: "Test rules" },
      { href: "/legal/certificates", label: "Certificate policy" },
      { href: "/legal/cookies", label: "Cookie notice" },
      { href: "/legal/accessibility", label: "Accessibility" },
      { href: "/legal/grievance", label: "Grievance redressal" },
      { href: "/legal", label: "All legal documents" },
    ],
  },
];
