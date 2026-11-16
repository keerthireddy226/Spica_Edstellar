import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/page/LegalDoc";
import { company } from "@/lib/site";

export const metadata: Metadata = {
  title: "Grievance redressal",
  description: "How to raise a complaint about Spica or about how your personal data is handled, and who the Grievance Officer is.",
};

export default function GrievancePage() {
  return (
    <LegalDoc
      title="Grievance redressal"
      lead="How to raise a complaint about Spica or about how your personal data is handled."
      updated="16 November 2026"
      sections={[
        {
          id: "officer",
          title: "Grievance Officer",
          body: (
            <p>
              Name: [Grievance Officer name]
              <br />
              Email: {company.privacyEmail}
              <br />
              Address: {company.legalName}, {company.address}
            </p>
          ),
        },
        {
          id: "what",
          title: "What you can raise",
          body: (
            <ul>
              <li>How your personal data is collected, used, shared, kept or deleted.</li>
              <li>A request to see, correct, download or delete your data that was not handled properly.</li>
              <li>Any other complaint about Spica that support has not resolved.</li>
            </ul>
          ),
        },
        {
          id: "how",
          title: "How to raise it",
          body: (
            <p>
              Write to the Grievance Officer with your name, the email address of your Spica account, what happened and what you would like us to
              do. For a question about a score, first use the score review in Spica: see the <Link href="/legal/certificates">certificate policy</Link>.
            </p>
          ),
        },
        {
          id: "next",
          title: "What happens next",
          body: <p>We confirm that we have received your complaint and reply with our answer within [response time — to be confirmed].</p>,
        },
        {
          id: "escalate",
          title: "If you are not satisfied",
          body: (
            <p>
              In India, after using this process you can complain to the Data Protection Board of India. In the European Union or the UK you can
              complain to your data protection authority.
            </p>
          ),
        },
      ]}
    />
  );
}
