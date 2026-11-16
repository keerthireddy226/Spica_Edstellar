import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";

export const metadata: Metadata = { title: "Terms and Conditions" };

export default function TermsPage() {
  return (
    <>
    <PageHero
      crumbs={[{ href: "/legal", label: "Legal" }, { label: "Terms and Conditions" }]}
      eyebrow="Legal"
      icon={<FileText size={16} />}
      tone="gold"
      title="Terms and Conditions"
      lead="The Terms are being finalised and will be published here before launch."
    />
    <section className="section">
      <div className="wrap prose" style={{ maxWidth: 820 }}>
        <p>
          Until then, the key rules are: Spica is for people aged 18 and over; real tests must be taken alone, without notes, other devices,
          translation or AI tools; and refunds follow the rules on our <Link href="/pricing">pricing page</Link>.
        </p>
      </div>
    </section>
    </>
  );
}
