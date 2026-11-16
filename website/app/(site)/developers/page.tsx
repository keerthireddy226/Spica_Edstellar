import type { Metadata } from "next";
import Link from "next/link";
import { APP_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Developers", description: "The Spica API, webhooks, company sign-in (SAML, OpenID Connect) and SCIM for connecting HR, learning and hiring systems." };

export default function DevelopersPage() {
  return (
    <section className="section">
      <div className="wrap">
        <p className="eyebrow">Developers</p>
        <h1>Connect Spica to your systems</h1>
        <p className="lead">On the Enterprise plan, connect Spica to your HR, learning and hiring systems with a REST API, signed webhooks, company sign-in and automatic accounts.</p>
        <div className="grid g2" style={{ marginTop: 28 }}>
          <div className="card">
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
          <div className="card">
            <h3>Webhooks</h3>
            <ul className="ticks">
              <li>Learner created, deactivated or moved; licences assigned</li>
              <li>Certificate issued; batch completed</li>
              <li>Candidate invited, finished, decided or expired</li>
              <li>Signed with a secret, retried six times</li>
            </ul>
          </div>
          <div className="card">
            <h3>Company sign-in</h3>
            <p className="muted">SAML 2.0 and OpenID Connect with verified email domains, with set-up guides for Microsoft Entra ID, Google Workspace and Okta.</p>
          </div>
          <div className="card">
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
  );
}
