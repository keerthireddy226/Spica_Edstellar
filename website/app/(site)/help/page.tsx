import type { Metadata } from "next";
import { APP_URL, company } from "@/lib/site";

export const metadata: Metadata = { title: "Help centre", description: "Help with Spica: getting started, taking a real test, results and certificates, and guides for organisations." };

const TOPICS: [string, string[]][] = [
  ["Getting started", ["Create an account and take the free placement test", "Choose a plan", "Practice Modules, practice tests and mock tests"]],
  ["Taking a real test", ["What you need: computer, browser, camera, microphone, internet", "The system check, ID and photo, screen sharing", "The rules during the test, and what happens if the connection drops"]],
  ["Results and certificates", ["When results come", "Download, share and add your certificate to LinkedIn", "Ask for a person to review your score"]],
  ["For organisations", ["Set up your organisation and add people", "Licences, credits, batches and programs", "Company sign-in, automatic accounts, API keys"]],
];

export default function HelpPage() {
  return (
    <section className="section">
      <div className="wrap">
        <p className="eyebrow">Help centre</p>
        <h1>How can we help?</h1>
        <p className="lead">Short guides for learners, test takers and organisations. If you are signed in, the Help page in Spica answers questions about your own account.</p>
        <div className="grid g2" style={{ marginTop: 28 }}>
          {TOPICS.map(([t, items]) => (
            <div className="card" key={t}>
              <h3>{t}</h3>
              <ul className="ticks">
                {items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="actions">
          <a className="btn primary" href={`${APP_URL}/help`}>
            Open Help in Spica
          </a>
          <a className="btn ghost" href="/contact?topic=support">
            Contact support
          </a>
        </div>
        <p className="muted" style={{ marginTop: 16, fontSize: "0.9rem" }}>
          The full help centre with step-by-step articles is coming soon. Support: {company.supportEmail}.
        </p>
      </div>
    </section>
  );
}
