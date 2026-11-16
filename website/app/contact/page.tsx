import type { Metadata } from "next";
import { ContactForm } from "@/components/ContactForm";
import { company } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Spica: book a demo, ask about pricing, get help with your account or a test, or a privacy question.",
};

export default function ContactPage() {
  const rows: [string, string][] = [
    ["Sales and demos", company.salesEmail],
    ["Support", company.supportEmail],
    ["Privacy and data protection", company.privacyEmail],
    ["Grievance Officer (India)", "[name and email]"],
    ["Security", company.securityEmail],
    ["Company", `${company.legalName}, ${company.address}`],
  ];
  return (
    <section className="section">
      <div className="wrap grid g2" style={{ gap: 48, alignItems: "start" }}>
        <div>
          <p className="eyebrow">Contact</p>
          <h1>Talk to us</h1>
          <p className="lead">Book a demo, ask about pricing for your organisation, or get help with your account or a test.</p>
          <div className="table-wrap" style={{ marginTop: 24 }}>
            <table className="t">
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <b>{k}</b>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
