import type { Metadata } from "next";
import Link from "next/link";
import { Fingerprint, Accessibility, ArrowRight, ArrowUpRight, Award, Building2, ClipboardCheck, Cookie, FileText, Lock, MessageSquareWarning, ReceiptText, Scale, ShieldCheck, User } from "lucide-react";
import { APP_URL } from "@/lib/site";
import { PageHero } from "@/components/page/PageHero";

export const metadata: Metadata = {
  title: "Legal",
  description: "All of Spica's legal documents: terms, privacy, refunds, test rules, certificates, cookies, accessibility, grievance redressal, privacy notices and the data processing agreement.",
};

type Doc = { title: string; text: string; href?: string; external?: boolean; status?: string; icon: React.ElementType };

const GROUPS: { title: string; icon: React.ElementType; docs: Doc[] }[] = [
  {
    title: "For everyone",
    icon: User,
    docs: [
      { title: "Terms and Conditions", text: "The rules for using Spica, payments, refunds and tests.", href: "/legal/terms", status: "Being finalised", icon: FileText },
      { title: "Privacy Policy", text: "What data Spica collects, why, how long it is kept and your rights.", href: "/legal/privacy", status: "Being finalised", icon: ShieldCheck },
      { title: "Refunds and cancellation", text: "How to cancel, when we refund, and how Spica is delivered.", href: "/legal/refunds", icon: ReceiptText },
      { title: "Test rules", text: "Taking a real test alone, identity checks, proctoring, reviews and retakes.", href: "/legal/test-rules", icon: ClipboardCheck },
      { title: "Certificate policy", text: "When certificates are issued, how long they are valid and how to check one.", href: "/legal/certificates", icon: Award },
      { title: "Biometric data policy", text: "Face and voice checks: consent, the alternative, and deletion.", href: "/legal/biometric-data", icon: Fingerprint },
      { title: "Cookie notice", text: "No advertising or tracking cookies.", href: "/legal/cookies", icon: Cookie },
      { title: "Accessibility", text: "Using the website and tests with a disability.", href: "/legal/accessibility", icon: Accessibility },
      { title: "Grievance redressal", text: "How to raise a complaint, and our Grievance Officer.", href: "/legal/grievance", icon: MessageSquareWarning },
    ],
  },
  {
    title: "Privacy notices",
    icon: Lock,
    docs: [
      { title: "Free accounts", text: "For people using Spica for free.", href: `${APP_URL}/legal/privacy-individual-free.html`, external: true, icon: Lock },
      { title: "Paid plans", text: "For people who buy a plan or a test.", href: `${APP_URL}/legal/privacy-individual-paid.html`, external: true, icon: Lock },
      { title: "Organisations", text: "For learners, managers and admins whose organisation gives them Spica.", href: `${APP_URL}/legal/privacy-organizations.html`, external: true, icon: Lock },
      { title: "Test takers", text: "For candidates and applicants invited to a test.", href: `${APP_URL}/legal/privacy-assessment-only.html`, external: true, icon: Lock },
    ],
  },
  {
    title: "For organisations",
    icon: Building2,
    docs: [
      { title: "Data Processing Agreement", text: "How Spica processes your people's data on your behalf.", href: `${APP_URL}/legal/data-processing-agreement.html`, external: true, icon: Scale },
      { title: "Customer Agreement", text: "The agreement for organisations that buy licences or credits.", status: "Available on request", href: "/contact?topic=sales", icon: FileText },
      { title: "Security questionnaire", text: "Our completed answers to common security questions.", status: "Available on request", href: "/contact?topic=sales", icon: ShieldCheck },
    ],
  },
];

export default function LegalPage() {
  return (
    <>
      <PageHero
        crumbs={[{ label: "Legal" }]}
        eyebrow="Legal"
        icon={<Scale size={16} />}
        title="Legal documents"
        lead="Every policy and agreement for Spica in one place: for people who use Spica, for test takers, and for organisations."
      />
      {GROUPS.map((g, gi) => {
        const GI = g.icon;
        return (
          <section key={g.title} className={`section${gi % 2 ? " alt" : ""}`}>
            <div className="wrap">
              <div className="sec-head" data-reveal>
                <p className="eyebrow">
                  <GI size={14} /> {g.title}
                </p>
              </div>
              <div className="doc-grid">
                {g.docs.map((d, i) => {
                  const I = d.icon;
                  const inner = (
                    <>
                      <span className="tcard-icon">
                        <I size={20} />
                      </span>
                      <h3>{d.title}</h3>
                      <p className="muted">{d.text}</p>
                      <span className="doc-foot">
                        {d.status ? <span className="doc-status">{d.status}</span> : <span />}
                        <span className="tcard-more">
                          {d.status === "Available on request" ? "Ask us" : "Read"}{" "}
                          {d.external ? <ArrowUpRight size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
                        </span>
                      </span>
                    </>
                  );
                  return d.external ? (
                    <a key={d.title} className="tcard doc-card" href={d.href} data-reveal style={{ ["--i" as string]: i % 4 }}>
                      {inner}
                    </a>
                  ) : (
                    <Link key={d.title} className="tcard doc-card" href={d.href!} data-reveal style={{ ["--i" as string]: i % 4 }}>
                      {inner}
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}
