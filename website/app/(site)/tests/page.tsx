import type { Metadata } from "next";
import Link from "next/link";
import { TESTS } from "@/lib/tests";
import { money } from "@/lib/prices";

export const metadata: Metadata = {
  title: "English tests",
  description: "Six online English tests: 4 Skills Essentials, Placement, Professional English, Speaking & Listening, Writing and Level Tests, all on the Spica 10–90 scale and CEFR levels.",
};

export default function TestsPage() {
  return (
    <>
      <section className="section">
        <div className="wrap">
          <p className="eyebrow">The tests</p>
          <h1>Six English tests, one scale</h1>
          <p className="lead">
            Every Spica test runs online, is scored on the Spica scale from 10 to 90 and is linked to the CEFR levels A1 to C2. Choose the test
            that matches what you need to know.
          </p>
          <div className="table-wrap" style={{ marginTop: 32 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Best for</th>
                  <th>Questions and time</th>
                  <th>Skills</th>
                  <th>Price (individuals)</th>
                </tr>
              </thead>
              <tbody>
                {TESTS.map((t) => (
                  <tr key={t.slug}>
                    <td>
                      <Link href={`/tests/${t.slug}`}>
                        <b>{t.name}</b>
                      </Link>
                    </td>
                    <td>{t.short}</td>
                    <td>
                      {t.questions} questions, {t.minutes.toLowerCase()}
                    </td>
                    <td>{t.skills.join(", ")}</td>
                    <td>
                      {money(t.priceKey, "INR")} / {money(t.priceKey, "USD")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 14, fontSize: "0.9rem" }}>
            Prices are for one real test with a score report (and a certificate, except Level Tests). Organisations pay with credits; see{" "}
            <Link href="/pricing">Pricing</Link>.
          </p>
        </div>
      </section>
      <section className="section alt">
        <div className="wrap grid g3">
          <div className="card">
            <h3>Same rules for every test</h3>
            <p className="muted">Each question has a timer. Recordings play at most twice. A question left blank counts as wrong.</p>
          </div>
          <div className="card">
            <h3>A free sample first</h3>
            <p className="muted">Before a real test you can take a short sample with the same checks, to make sure your camera, microphone and screen sharing work.</p>
          </div>
          <div className="card">
            <h3>Results you can check</h3>
            <p className="muted">Real tests end in a score report and a certificate with a QR code that anyone can check online.</p>
          </div>
        </div>
      </section>
    </>
  );
}
