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

export const nav = [
  { href: "/tests", label: "Tests" },
  { href: "/solutions", label: "Who it's for" },
  { href: "/pricing", label: "Pricing" },
  { href: "/demo", label: "Demo" },
  { href: "/certificate-check", label: "Check a certificate" },
];

export const footer = [
  {
    title: "Tests",
    links: [
      { href: "/tests/english-4-skills-essentials", label: "English 4 Skills Essentials" },
      { href: "/tests/english-placement", label: "English Placement" },
      { href: "/tests/professional-english", label: "Professional English" },
      { href: "/tests/speaking-and-listening", label: "Speaking & Listening" },
      { href: "/tests/writing", label: "English Writing" },
      { href: "/tests/level-tests", label: "Level Tests (A1–C2)" },
    ],
  },
  {
    title: "Who it's for",
    links: [
      { href: "/solutions/companies", label: "Companies" },
      { href: "/solutions/recruiters", label: "Recruiters" },
      { href: "/solutions/universities", label: "Universities" },
      { href: "/solutions/training-providers", label: "Training providers" },
      { href: "/solutions/individuals", label: "Individuals" },
    ],
  },
  {
    title: "Spica",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/demo", label: "Demo" },
      { href: "/security", label: "Security and trust" },
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/help", label: "Help centre" },
      { href: "/developers", label: "Developers (API)" },
      { href: "/certificate-check", label: "Check a certificate" },
      { href: "/legal", label: "Legal" },
    ],
  },
];
