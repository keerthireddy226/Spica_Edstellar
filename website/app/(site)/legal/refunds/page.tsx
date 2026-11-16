import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/page/LegalDoc";
import { company } from "@/lib/site";

export const metadata: Metadata = {
  title: "Refunds and cancellation",
  description: "How to cancel a Spica subscription, when purchases are refunded, and how Spica is delivered.",
};

export default function RefundsPage() {
  return (
    <LegalDoc
      title="Refunds and cancellation"
      lead="How to cancel, when we refund, and how Spica is delivered."
      updated="16 November 2026"
      note={
        <>
          This page summarises the refund rules in our <Link href="/legal/terms">Terms and Conditions</Link>. If the two ever differ, the Terms apply.
        </>
      }
      sections={[
        {
          id: "cancel",
          title: "Cancelling a monthly subscription",
          body: (
            <p>
              You can cancel at any time in Plans, inside Spica. You keep Full access until the end of the month you have paid for and are not charged
              again. You can turn renewal back on before then.
            </p>
          ),
        },
        {
          id: "refunds",
          title: "When we refund",
          body: (
            <table>
              <thead>
                <tr>
                  <th>Purchase</th>
                  <th>Refund</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>A purchase you have not started using (no practice session, test or attempt used)</td>
                  <td>Full refund if you ask within 14 days of buying</td>
                </tr>
                <tr>
                  <td>Full access, after you have started using it</td>
                  <td>No refund for time already used or for months not yet used. For flexibility, choose the monthly subscription</td>
                </tr>
                <tr>
                  <td>A real test or Level Test attempt</td>
                  <td>
                    The attempt is used when the test starts. It is given back only if the test was stopped before any question was shown, or if a
                    fault on our side stopped you from finishing (you can ask for a new attempt or a refund)
                  </td>
                </tr>
                <tr>
                  <td>Monthly subscription</td>
                  <td>No refund for a month that has started; cancelling stops the next charge</td>
                </tr>
                <tr>
                  <td>Certificate extras (12 more months, or valid for life)</td>
                  <td>Full refund within 14 days if not yet applied to a certificate</td>
                </tr>
              </tbody>
            </table>
          ),
        },
        {
          id: "eu-uk",
          title: "If you buy in the European Union or the UK",
          body: (
            <p>
              You have the right to cancel within 14 days of buying. Because Spica gives you access straight away, we ask you at checkout to agree
              that access starts now and that you lose this right once you start using it.
            </p>
          ),
        },
        {
          id: "how",
          title: "How to ask for a refund",
          body: (
            <p>
              Write to {company.supportEmail} with your invoice number. We reply within 5 working days and return the money to the original payment
              method. Your rights under consumer law in your country are not affected.
            </p>
          ),
        },
        {
          id: "organisations",
          title: "Organisations",
          body: (
            <p>
              Credits for invitations that expire unused, and for tests stopped before the first question, go back to your credit balance.
              Licences and invoices for organisations follow the refund terms in your agreement with us.
            </p>
          ),
        },
        {
          id: "delivery",
          title: "Delivery",
          body: (
            <p>
              Spica is an online service. Access starts as soon as your payment is confirmed, and everything you buy is used inside Spica. Nothing is
              posted to you.
            </p>
          ),
        },
      ]}
    />
  );
}
