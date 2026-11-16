import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/page/LegalDoc";
import { money } from "@/lib/prices";

export const metadata: Metadata = {
  title: "Certificate policy",
  description: "When a Spica certificate is issued, how long it is valid, how anyone can check it, and when it can be withdrawn.",
};

export default function CertificatePolicyPage() {
  return (
    <LegalDoc
      title="Certificate policy"
      lead="When a certificate is issued, how long it is valid, how anyone can check it, and when it can be withdrawn."
      updated="16 November 2026"
      sections={[
        {
          id: "issued",
          title: "When a certificate is issued",
          body: (
            <p>
              Certificates come only from a real, proctored test (the final assessment). A certificate is issued once every answer is scored, the
              session&apos;s checks are clear, and a short waiting period has passed. Level Tests show passed or not passed and do not give a
              certificate.
            </p>
          ),
        },
        {
          id: "shows",
          title: "What it shows",
          body: (
            <p>
              The name, the test taken, the CEFR level and Spica score (10–90), overall and for each skill, the test date, the date it is valid until,
              and whether the identity was verified. Scores are Spica&apos;s measure of your English. They are not an official result of any other
              exam board and are not designed for immigration, visa or university admission decisions that require a specific approved test.
            </p>
          ),
        },
        {
          id: "validity",
          title: "How long it is valid",
          body: (
            <p>
              A certificate is valid for 12 months. You can keep it valid for 12 more months ({money("certExtend", "INR")} / {money("certExtend", "USD")}
              ) or make it valid for life ({money("certLifetime", "INR")} / {money("certLifetime", "USD")}).
            </p>
          ),
        },
        {
          id: "check",
          title: "How anyone can check it",
          body: (
            <p>
              Each certificate has a code and a QR code. Anyone can enter the code on the <Link href="/certificate-check">certificate check page</Link>{" "}
              to see whether it is valid, expired or withdrawn. If the holder chooses, they can also see the full score report (without the answers);
              this is off until the holder switches it on. Holders can add their certificate to LinkedIn.
            </p>
          ),
        },
        {
          id: "withdrawn",
          title: "When a certificate can be withdrawn",
          body: (
            <p>
              We may withdraw a certificate if a later review confirms that a <Link href="/legal/test-rules">test rule</Link> was broken, and restore
              it if the session is cleared.
            </p>
          ),
        },
        {
          id: "review",
          title: "Score reviews",
          body: (
            <p>
              You can ask once for each result, within the period shown, for a person to review it. We may confirm the result, change it, or offer a
              new attempt.
            </p>
          ),
        },
      ]}
    />
  );
}
