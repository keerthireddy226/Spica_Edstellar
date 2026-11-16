import type { Metadata } from "next";
import { LegalDoc } from "@/components/page/LegalDoc";
import { company } from "@/lib/site";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "How Spica's website and tests can be used with a disability, known limits and how to ask for help.",
};

export default function AccessibilityPage() {
  return (
    <LegalDoc
      title="Accessibility"
      lead="We want everyone to be able to use Spica. This page explains what works today, what does not yet, and how to ask for help."
      updated="16 November 2026"
      sections={[
        {
          id: "website",
          title: "This website",
          body: (
            <ul>
              <li>Every page can be used with a keyboard, and a “Skip to content” link is the first thing on each page.</li>
              <li>Pages use clear headings, text alternatives for pictures, and colours checked for contrast.</li>
              <li>Pages work on phones and small screens.</li>
              <li>If your device asks for reduced motion, the website turns its animations off.</li>
              <li>We check pages with automated accessibility tests. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.1 level AA.</li>
            </ul>
          ),
        },
        {
          id: "limits",
          title: "What does not work yet",
          body: (
            <ul>
              <li>Listening questions need you to hear recordings, and speaking questions need you to speak into a microphone.</li>
              <li>Real tests need a camera and screen sharing for proctoring.</li>
              <li>Every test taker has the same time on each question. Extra time and other adjustments are not offered at the moment.</li>
            </ul>
          ),
        },
        {
          id: "help",
          title: "Ask for help or tell us about a problem",
          body: (
            <p>
              If something on the website or in Spica is hard to use, write to {company.supportEmail}. Tell us the page and what happened, and we
              will help you and work on a fix.
            </p>
          ),
        },
      ]}
    />
  );
}
