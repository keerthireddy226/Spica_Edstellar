import type { Metadata } from "next";
import { Briefcase, Building, LifeBuoy, Mail, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { ContactForm } from "@/components/ContactForm";
import { PageHero } from "@/components/page/PageHero";
import { company } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Spica: book a demo, ask about pricing, get help with your account or a test, or a privacy question.",
};

export default function ContactPage() {
  const rows: [React.ElementType, string, string][] = [
    [Briefcase, "Sales and demos", company.salesEmail],
    [LifeBuoy, "Support", company.supportEmail],
    [ShieldCheck, "Privacy and data protection", company.privacyEmail],
    [UserRound, "Grievance Officer (India)", "[name and email]"],
    [ShieldAlert, "Security", company.securityEmail],
    [Building, "Company", `${company.legalName}, ${company.address}`],
  ];
  return (
    <>
      <PageHero
        crumbs={[{ label: "Contact" }]}
        eyebrow="Contact"
        icon={<Mail size={16} />}
        tone="sky"
        top
        title={
          <>
            Talk to <span className="ph-accent">us</span>
          </>
        }
        lead="Book a demo, ask about pricing for your organisation, or get help with your account or a test."
        actions={
          <ul className="vlist ph-points">
            <li>
              <Briefcase size={16} /> Demos and pricing for companies, recruiters, universities and training providers
            </li>
            <li>
              <LifeBuoy size={16} /> Help with your account, a test or a certificate
            </li>
            <li>
              <ShieldCheck size={16} /> Privacy and data protection questions
            </li>
          </ul>
        }
        visual={
          <div className="vcard">
            <ContactForm />
          </div>
        }
      />
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Write to the right team</p>
            <h2>Who to contact</h2>
          </div>
          <div className="grid g3">
            {rows.map(([I, k, v], i) => (
              <div key={k} className="card icard" data-reveal style={{ ["--i" as string]: i % 3 }}>
                <span className="icard-icon">
                  <I size={20} />
                </span>
                <h3>{k}</h3>
                <p className="muted">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
