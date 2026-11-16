import type { Metadata } from "next";
import Link from "next/link";
import { APP_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <section className="section">
      <div className="wrap" style={{ maxWidth: 820 }}>
        <p className="crumbs">
          <Link href="/legal">Legal</Link> / Privacy Policy
        </p>
        <h1>Privacy Policy</h1>
        <p className="lead">The full Privacy Policy is being finalised and will be published here before launch.</p>
        <p>
          The privacy notices that apply today are on our <Link href="/legal">legal page</Link>, and every user agrees to the one that applies
          to them inside Spica. In short: data is stored in Singapore, never sold, deleted on a fixed schedule, and you can download or delete
          it at any time. See <Link href="/security">Security and trust</Link> for details.
        </p>
        <p>
          <a href={`${APP_URL}/legal/privacy-individual-free.html`}>Read the privacy notice for free accounts</a>.
        </p>
      </div>
    </section>
  );
}
