import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/page/LegalDoc";
import { company } from "@/lib/site";

export const metadata: Metadata = {
  title: "Biometric data policy",
  description: "How Spica uses face and voice data to confirm identity in proctored tests: separate consent, a manual alternative, where it is processed and when it is deleted.",
};

export default function BiometricPolicyPage() {
  return (
    <LegalDoc
      title="Biometric data policy"
      lead="How Spica uses face and voice data to confirm that the right person takes a test, and when that data is deleted."
      updated="16 November 2026"
      note={
        <>
          This page summarises the biometric parts of our <Link href="/legal">privacy notices</Link>. If the two ever differ, the privacy notice
          that applies to you is the one that counts.
        </>
      }
      sections={[
        {
          id: "what",
          title: "What we collect",
          body: (
            <ul>
              <li>A photo of your face before a real test, and where required a photo of your identity document.</li>
              <li>Photos and screenshots taken during a proctored test.</li>
              <li>
                Only if you agree: a face template and a voice template, which are numbers made from your photo and voice so they can be compared
                with later photos and recordings.
              </li>
            </ul>
          ),
        },
        {
          id: "why",
          title: "Why we use it",
          body: <p>Only to confirm that the person taking a test is the person the result belongs to, and to keep results trustworthy.</p>,
        },
        {
          id: "consent",
          title: "Your consent and the alternative",
          body: (
            <p>
              Face and voice matching need your separate consent, which you can refuse or withdraw at any time. If you do not agree, you can choose a
              manual identity check instead, and you can still take the test.
            </p>
          ),
        },
        {
          id: "where",
          title: "Where it is processed",
          body: <p>Face and voice matching run on Spica&apos;s own servers. Biometric data is never sold and never used to train AI models.</p>,
        },
        {
          id: "retention",
          title: "When it is deleted",
          body: (
            <table>
              <tbody>
                <tr>
                  <td>Face and voice templates</td>
                  <td>3 months after your last test, or straight away if you withdraw your consent</td>
                </tr>
                <tr>
                  <td>Proctoring photos, screenshots, recordings and identity document images</td>
                  <td>30 days after the test if nothing was flagged; at most 60 days if it was flagged, and up to 1 year while a review is still open</td>
                </tr>
                <tr>
                  <td>Face-check photos</td>
                  <td>3 months (an organisation may choose up to 12 months)</td>
                </tr>
              </tbody>
            </table>
          ),
        },
        {
          id: "decisions",
          title: "No automatic decisions",
          body: <p>A failed face or voice match never fails you automatically. A trained person reviews every flagged session before any decision.</p>,
        },
        {
          id: "contact",
          title: "Questions and withdrawing consent",
          body: (
            <p>
              Write to {company.privacyEmail} to withdraw your consent, ask what we hold or ask for it to be deleted. See also{" "}
              <Link href="/legal/grievance">Grievance redressal</Link>.
            </p>
          ),
        },
      ]}
    />
  );
}
