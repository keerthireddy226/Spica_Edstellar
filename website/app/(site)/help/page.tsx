import type { Metadata } from "next";
import { Award, Building2, LifeBuoy, MonitorCheck, Rocket } from "lucide-react";
import { APP_URL, company } from "@/lib/site";
import { PageHero } from "@/components/page/PageHero";

const TOPIC_ICON: Record<string, React.ElementType> = {
  "Getting started": Rocket,
  "Taking a real test": MonitorCheck,
  "Results and certificates": Award,
  "For organisations": Building2,
};

export const metadata: Metadata = { title: "Help centre", description: "Help with Spica: getting started, taking a real test, results and certificates, and guides for organisations." };

const TOPICS: [string, string[]][] = [
  ["Getting started", ["Create an account and take the free placement test", "Choose a plan", "Practice Modules, practice tests and mock tests"]],
  ["Taking a real test", ["What you need: computer, browser, camera, microphone, internet", "The system check, ID and photo, screen sharing", "The rules during the test, and what happens if the connection drops"]],
  ["Results and certificates", ["When results come", "Download, share and add your certificate to LinkedIn", "Ask for a person to review your score"]],
  ["For organisations", ["Set up your organisation and add people", "Licences, credits, batches and programs", "Company sign-in, automatic accounts, API keys"]],
];

export default function HelpPage() {
  return (
    <>
    <PageHero
      crumbs={[{ label: "Help centre" }]}
      eyebrow="Help centre"
      icon={<LifeBuoy size={16} />}
      tone="moss"
      title={
        <>
          How can we <span className="ph-accent">help?</span>
        </>
      }
      lead="Short guides for learners, test takers and organisations. If you are signed in, the Help page in Spica answers questions about your own account."
      actions={
        <>
          <a className="btn primary" href={`${APP_URL}/help`}>
            Open Help in Spica
          </a>
          <a className="btn ghost" href="/contact?topic=support">
            Contact support
          </a>
        </>
      }
    />
    <section className="section">
      <div className="wrap">
        <div className="grid g2">
          {TOPICS.map(([t, items], k) => {
            const I = TOPIC_ICON[t] ?? Rocket;
            return (
            <div className="card icard" key={t} data-reveal style={{ ["--i" as string]: k % 2 }}>
              <span className="icard-icon">
                <I size={20} />
              </span>
              <h3>{t}</h3>
              <ul className="ticks">
                {items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
            );
          })}
        </div>
        <p className="muted" style={{ marginTop: 16, fontSize: "0.9rem" }}>
          The full help centre with step-by-step articles is coming soon. Support: {company.supportEmail}.
        </p>
      </div>
    </section>
    </>
  );
}
