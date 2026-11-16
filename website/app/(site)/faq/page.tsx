import type { Metadata } from "next";
import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers to common questions about Spica's English tests, test day, scores and certificates, prices, organisations and privacy.",
};

// Answers repeat what the rest of the site says; keep them in step.
const GROUPS: { title: string; items: [string, React.ReactNode][] }[] = [
  {
    title: "The tests",
    items: [
      ["Which test should I take?", <>It depends on what you need to know. See <Link href="/tests">Which test do I need?</Link> on the Tests page.</>],
      ["How long does a test take?", "From about 17 minutes (Speaking & Listening) to about 60 minutes (Professional English)."],
      ["Is there a free test?", "Yes. The placement test is free and gives a level for each skill. Before every real test you can also take a free sample with the same checks."],
      ["Will an accent lower the score?", "Speaking is scored on how clearly you are understood, not on your accent. British, American and Indian spellings are all accepted."],
      ["How are answers scored?", <>AI scores spoken and written answers against clear rules for each task; multiple-choice answers are marked by fixed rules. People review every proctoring flag. See <Link href="/how-ai-is-used">How AI is used</Link>.</>],
    ],
  },
  {
    title: "Test day",
    items: [
      ["What do I need?", <>A laptop or desktop computer with a camera, a microphone and an up-to-date browser, a stable connection and a quiet room. See <Link href="/how-to-take-a-test">How to take a test</Link>.</>],
      ["What if something goes wrong during the test?", "If a fault on our side stops you from finishing, you can ask for a new attempt or a refund."],
      ["Can I get extra time?", <>Yes, if a disability affects how you take a test. See <Link href="/legal/accessibility">Accessibility</Link>.</>],
      ["Do job candidates need an account?", "No. Candidates open the link in their invitation, take one proctored test, and the recruiter receives the report."],
    ],
  },
  {
    title: "Scores and certificates",
    items: [
      ["Is a Spica certificate official or accredited?", "It is Spica's own certificate. It shows a CEFR level and anyone can check it online. It is not a government or visa certificate."],
      ["How long is a certificate valid?", "12 months. It can be extended for another 12 months or made valid for life."],
      ["How does someone check my certificate?", <>They enter its code on the <Link href="/certificate-check">certificate check page</Link> or scan its QR code.</>],
      ["Can I ask for my score to be reviewed?", "Yes, once for each result. A person reviews it and may confirm it, change it or offer a new attempt."],
      ["When can I retake a test?", "After a final assessment below your goal, after 30 days. After a Level Test that was not passed, the next one at that level opens after 7 days."],
    ],
  },
  {
    title: "Prices and payment",
    items: [
      ["Which currencies can I pay in?", "INR, USD, EUR, GBP, AED and SGD. Other countries pay in US dollars."],
      ["Can I cancel a monthly subscription?", "Yes, at any time in Plans. You keep Full access to the end of the month you paid for and are not charged again."],
      ["Can I get a refund?", <>A purchase you have not started using can be refunded within 14 days. See <Link href="/legal/refunds">Refunds and cancellation</Link>.</>],
    ],
  },
  {
    title: "Organisations",
    items: [
      ["Can we try Spica first?", <>Yes. Ask about a pilot on the <Link href="/demo">Demo page</Link>.</>],
      ["Can we use our own sign-in and branding?", "Yes. Organisations can add their logo and colour, and on Enterprise use company sign-in (SAML or OpenID Connect) and automatic accounts (SCIM)."],
      ["Do unused credits come back?", "Yes. Credits for invitations that expire unused, and for tests stopped before the first question, go back to your balance."],
    ],
  },
  {
    title: "Privacy",
    items: [
      ["How is our data protected?", <>Data is encrypted, recordings and photos are deleted on a fixed schedule, and data is never sold or used to train AI models. See <Link href="/security">Security and trust</Link>.</>],
      ["Can I delete my data?", <>Yes. You can download or delete your data at any time. See the <Link href="/legal">privacy notices</Link>.</>],
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <PageHero
        crumbs={[{ href: "/help", label: "Resources" }, { label: "FAQ" }]}
        eyebrow="FAQ"
        icon={<HelpCircle size={16} />}
        title={
          <>
            Frequently asked <span className="ph-accent">questions</span>
          </>
        }
        lead="Quick answers about the tests, test day, scores and certificates, prices, organisations and privacy."
        actions={
          <div className="faq-jump">
            {GROUPS.map((g) => (
              <a key={g.title} href={`#${g.title.toLowerCase().replace(/\s+/g, "-")}`}>
                {g.title}
              </a>
            ))}
          </div>
        }
      />
      {GROUPS.map((g, i) => (
        <section key={g.title} id={g.title.toLowerCase().replace(/\s+/g, "-")} className={`section faq-section${i % 2 ? " alt" : ""}`}>
          <div className="wrap split">
            <div className="sec-head" data-reveal>
              <h2>{g.title}</h2>
            </div>
            <div className="faq">
              {g.items.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      ))}
    </>
  );
}
