import type { Metadata } from "next";
import Link from "next/link";
import { Code2, KeyRound, Users, Webhook } from "lucide-react";
import { APP_URL } from "@/lib/site";
import { PageHero } from "@/components/page/PageHero";
import { ConnectMock } from "@/components/page/Visuals";

export const metadata: Metadata = { title: "Developers", description: "The Spica API, webhooks, company sign-in (SAML, OpenID Connect) and SCIM for connecting HR, learning and hiring systems." };

export default function DevelopersPage() {
  return (
    <>
    <PageHero
      crumbs={[{ label: "Developers" }]}
      eyebrow="Developers"
      icon={<Code2 size={16} />}
      tone="sky"
      title={
        <>
          Connect Spica to <span className="ph-accent">your systems</span>
        </>
      }
      lead="On the Enterprise plan, connect Spica to your HR, learning and hiring systems with a REST API, signed webhooks, company sign-in and automatic accounts."
      actions={
        <a className="btn primary" href={`${APP_URL}/api/v1/openapi.json`}>
          API reference (OpenAPI)
        </a>
      }
      visual={<ConnectMock items={["REST API", "Webhooks", "SAML 2.0", "OpenID Connect", "SCIM 2.0", "Microsoft Entra ID", "Google Workspace", "Okta"]} />}
    />
    <section className="section">
      <div className="wrap">
        <div className="grid g2">
          <div className="card icard" data-reveal style={{ ["--i" as string]: 0 }}>
            <span className="icard-icon">
              <Code2 size={20} />
            </span>
            <h3>REST API</h3>
            <ul className="ticks">
              <li>Add, list and deactivate learners</li>
              <li>Read batches, certificates and analytics</li>
              <li>Recruitment: list jobs, invite candidates, read results</li>
              <li>API keys with read or read-and-write access, 120 requests a minute</li>
            </ul>
            <a className="btn ghost" href={`${APP_URL}/api/v1/openapi.json`}>
              API reference (OpenAPI)
            </a>
          </div>
          <div className="card icard" data-reveal style={{ ["--i" as string]: 1 }}>
            <span className="icard-icon">
              <Webhook size={20} />
            </span>
            <h3>Webhooks</h3>
            <ul className="ticks">
              <li>Learner created, deactivated or moved; licences assigned</li>
              <li>Certificate issued; batch completed</li>
              <li>Candidate invited, finished, decided or expired</li>
              <li>Signed with a secret, retried six times</li>
            </ul>
          </div>
          <div className="card icard" data-reveal style={{ ["--i" as string]: 0 }}>
            <span className="icard-icon">
              <KeyRound size={20} />
            </span>
            <h3>Company sign-in</h3>
            <p className="muted">SAML 2.0 and OpenID Connect with verified email domains, with set-up guides for Microsoft Entra ID, Google Workspace and Okta.</p>
          </div>
          <div className="card icard" data-reveal style={{ ["--i" as string]: 1 }}>
            <span className="icard-icon">
              <Users size={20} />
            </span>
            <h3>Automatic accounts (SCIM 2.0)</h3>
            <p className="muted">Your identity provider adds, renames and deactivates learners in Spica. Deactivated people lose access at once; their history is kept.</p>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 20, fontSize: "0.92rem" }}>
          Breaking changes come with at least 90 days&apos; notice, and older API versions stay available for 12 months. Full documentation and
          integration guides are available to customers. <Link href="/contact?topic=sales">Ask about Enterprise</Link>.
        </p>
      </div>
    </section>
    </>
  );
}
