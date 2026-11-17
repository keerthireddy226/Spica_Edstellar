import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/page/LegalDoc";

export const metadata: Metadata = {
  title: "Test rules",
  description: "The rules for taking a real Spica test: taking it alone, identity checks, proctoring, what happens if a rule is broken, reviews and retakes.",
};

export default function TestRulesPage() {
  return (
    <LegalDoc
      title="Test rules"
      lead="Spica tests measure your own English. Before every real test you confirm that you will follow these rules."
      updated="16 November 2026"
      sections={[
        {
          id: "before",
          title: "Before the test",
          body: (
            <ul>
              <li>Use a computer with a camera, a microphone, a supported browser and a steady internet connection.</li>
              <li>Take the free sample test first: it uses the same checks, so you know your camera, microphone and screen sharing work.</li>
              <li>
                Follow the identity checks: a photo of you, and where required a photo of your identity document. Face and voice matching are used
                only if you agree to them; you can choose a manual identity check instead.
              </li>
            </ul>
          ),
        },
        {
          id: "during",
          title: "During the test",
          body: (
            <ul>
              <li>Take the test alone, in a quiet room, with your face visible to the camera, and keep your whole screen shared.</li>
              <li>Do not use notes, books, other devices, other people&apos;s help, translation tools or AI tools.</li>
              <li>Do not record, copy, photograph, share or publish any question, answer or part of a real test.</li>
              <li>Do not let anyone else take a test for you, and do not take a test for someone else.</li>
              <li>Use only the browser window of the test; leaving it is recorded.</li>
              <li>Every question has its own timer, the same for every test taker. Each recording plays once, and the answer timer starts when it ends. A question left blank counts as wrong.</li>
            </ul>
          ),
        },
        {
          id: "proctoring",
          title: "Proctoring",
          body: (
            <p>
              Real tests are proctored remotely: the camera, screen and test events are monitored as described on the test screen and in the privacy
              notice. Nothing is decided automatically: a trained person reviews any session that is flagged.
            </p>
          ),
        },
        {
          id: "broken",
          title: "If a rule is broken",
          body: (
            <p>
              We may withhold or cancel the result, withdraw a certificate, stop you from taking tests for a period, close your account, and tell the
              organisation that invited you. You can ask for this decision to be reviewed.
            </p>
          ),
        },
        {
          id: "review",
          title: "Asking for a score review",
          body: (
            <p>
              You can ask once for each result, within the period shown, for a person to review it. We may confirm the result, change it, or offer a
              new attempt. See the <Link href="/legal/certificates">certificate policy</Link>.
            </p>
          ),
        },
        {
          id: "retakes",
          title: "Retakes",
          body: (
            <p>
              After a final assessment below your goal you can take another real test after 30 days. After a Level Test that was not passed, the
              next one at that level opens after 7 days. Each attempt uses questions you have not seen where possible.
            </p>
          ),
        },
      ]}
    />
  );
}
