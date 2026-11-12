import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { tr } from "@/i18n/tr";

// Help: a short guide for each part of Spica. The "?" button in the top bar
// opens this page at the guide for the screen the person is on (see
// helpTopicFor). Public, so it also works before signing in.

export interface HelpTopic {
  id: string;
  title: () => string;
  points: (() => string)[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: () => tr("Getting started"),
    points: [
      () => tr("Your home page shows what to do next: your level, your journey and your recent practice."),
      () => tr("Start with the placement test. It finds your English level (A1 to C2) so practice matches your level."),
      () => tr("Use a computer with a microphone, in a quiet room. Speaking questions record your voice."),
      () => tr("Change the language of Spica with the language button at the top of the page."),
    ],
  },
  {
    id: "practice",
    title: () => tr("Practice, practice tests and mock tests"),
    points: [
      () => tr("Practice Modules train one question type at a time and explain each answer."),
      () => tr("Practice tests are short tests on one test type. Mock tests are full tests, timed like the real one."),
      () => tr("Your plan sets how many practice tests and mock tests you can take each month."),
      () => tr("Each recording plays twice. Answer within the time shown on the screen."),
      () => tr("Your reports are under My reports, with your score, level and what to work on."),
    ],
  },
  {
    id: "tests",
    title: () => tr("Final assessment and certificates"),
    points: [
      () => tr("The final assessment is the real test. It gives a score report and, once its checks are done, a certificate."),
      () => tr("You need a camera, a microphone and a photo ID. The test is recorded, and your face and ID are checked."),
      () => tr("Take it alone, in a quiet room, without notes or other people. Stay in the test window until you finish."),
      () => tr("A certificate is valid for one year. You can download it as a PDF, add it to LinkedIn, or share its check link."),
      () => tr("On your Certificates page you choose whether people who check your certificate can also see your full score report."),
    ],
  },
  {
    id: "plans",
    title: () => tr("Plans, payments and invoices"),
    points: [
      () => tr("Full access opens every test, practice test, mock test and Practice Module, with one final assessment."),
      () => tr("Buy 1, 3 or 6 months at once, or subscribe monthly by card. A subscription renews until you cancel it."),
      () => tr("If you cancel a subscription, you keep access until the end of the month you paid for."),
      () => tr("Manage billing opens a secure page where you change your card and see your payments."),
      () => tr("Your invoices are at the bottom of the Plans page. Open one to print it or save it as a PDF."),
    ],
  },
  {
    id: "account",
    title: () => tr("Your account and privacy"),
    points: [
      () => tr("Your profile holds your name, language, password and two-step sign-in."),
      () => tr("You can download your data or ask for your account to be deleted from your profile."),
      () => tr("Marketing emails are only sent if you agreed. You can turn them off in your profile or with the link in any such email."),
      () => tr("Only one sign-in at a time is allowed for each account. Signing in somewhere else signs you out here."),
    ],
  },
  {
    id: "organisation",
    title: () => tr("For organisation admins and managers"),
    points: [
      () => tr("Learners: add people one by one or from a file; they get an email to set their password."),
      () => tr("Batches group learners with dates and a goal level. Managers look after the batches given to them."),
      () => tr("Licences: one licence gives one learner one month of access. Assign them from the Licences page."),
      () => tr("Tests: give a test to learners or a batch. Each test uses credits; unused invitations return their credits."),
      () => tr("A learner with a disability can get extra time on every test: open the learner and choose the extra time."),
      () => tr("Reports and Analytics show progress, levels and results for each batch and learner."),
    ],
  },
  {
    id: "recruitment",
    title: () => tr("For recruiters"),
    points: [
      () => tr("Create a job opening, choose its test and minimum level, then invite candidates by email or share the job's public link."),
      () => tr("Each invitation uses credits. Invitations that expire before a question is seen return their credits."),
      () => tr("When a candidate finishes, you get a notification. Open the candidate to see the score report and play their spoken answers."),
      () => tr("A candidate with a disability can get extra time: choose it when you invite them, or on their row before they start."),
      () => tr("Your hiring system can connect through the Spica API: ask your organisation admin for an API key (Developers page)."),
    ],
  },
  {
    id: "reviews",
    title: () => tr("Reviewing test checks"),
    points: [
      () => tr("A flag means \"a person should look\", never \"cheated\". Look at the photos, recordings and notes before deciding."),
      () => tr("\"Unclear match\" on an ID means the ID photo may be small or old: compare the ID photo and the selfie yourself."),
      () => tr("Your decision is recorded with your name. The certificate is issued only after the checks are cleared."),
    ],
  },
  {
    id: "contact",
    title: () => tr("Still need help?"),
    points: [
      () => tr("Organisation learners: ask your organisation's admin first; they manage your access and tests."),
      () => tr("Everyone else: reply to any email from Spica and our team will help you."),
    ],
  },
];

// The guide for the screen at this address.
export function helpTopicFor(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p.includes("integrity") || p.includes("/review")) return "reviews";
  if (p.startsWith("/recruit") || p.includes("/recruitment")) return "recruitment";
  if (p.startsWith("/orgadmin") || p.startsWith("/manager")) return "organisation";
  if (p.startsWith("/plans") || p.startsWith("/spica-plans") || p.startsWith("/invoice") || p.startsWith("/checkout")) return "plans";
  if (p.startsWith("/assessment") || p.startsWith("/certificate")) return "tests";
  if (p.startsWith("/modules") || p.startsWith("/practice-tests") || p.startsWith("/mock-exams") || p.startsWith("/my-reports")) return "practice";
  if (p.includes("profile") || p.startsWith("/security")) return "account";
  return "getting-started";
}

export function Help() {
  const { hash } = useLocation();
  const active = hash.replace("#", "");
  useEffect(() => {
    if (active) document.getElementById(active)?.scrollIntoView({ block: "start" });
  }, [active]);
  return (
    <div className="app-surface min-h-screen px-4 py-8 sm:px-8 sm:py-10 flex flex-col items-center">
      <div className="w-full max-w-3xl flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <span className="font-logo font-bold text-2xl text-navy">Spica</span>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Help")}</h1>
          <p className="text-sm text-muted">{tr("Short guides to each part of Spica.")}</p>
        </div>
        <nav className="flex flex-wrap gap-2">
          {HELP_TOPICS.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className={`text-xs font-semibold px-3 py-1.5 rounded-pill border ${active === t.id ? "border-navy bg-navy/10 text-navy-deep" : "border-rule text-ink hover:bg-paper-warm"}`}
            >
              {t.title()}
            </a>
          ))}
        </nav>
        {HELP_TOPICS.map((t) => (
          <section
            key={t.id}
            id={t.id}
            className={`scroll-mt-6 bg-surface border rounded-card p-5 sm:p-6 flex flex-col gap-3 ${active === t.id ? "border-navy shadow-md" : "border-rule shadow-sm"}`}
          >
            <h2 className="font-display font-bold text-lg text-ink">{t.title()}</h2>
            <ul className="flex flex-col gap-2 list-disc pl-5">
              {t.points.map((p, i) => (
                <li key={i} className="text-sm text-ink">
                  {p()}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
