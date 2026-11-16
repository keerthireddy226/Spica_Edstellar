import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms and Conditions" };

export default function TermsPage() {
  return (
    <section className="section">
      <div className="wrap" style={{ maxWidth: 820 }}>
        <p className="crumbs">
          <Link href="/legal">Legal</Link> / Terms and Conditions
        </p>
        <h1>Terms and Conditions</h1>
        <p className="lead">The Terms are being finalised and will be published here before launch.</p>
        <p>
          Until then, the key rules are: Spica is for people aged 18 and over; real tests must be taken alone, without notes, other devices,
          translation or AI tools; and refunds follow the rules on our <Link href="/pricing">pricing page</Link>.
        </p>
      </div>
    </section>
  );
}
