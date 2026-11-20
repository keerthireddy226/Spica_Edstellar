import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Check, Compass, CreditCard, GraduationCap, Rocket, User, X } from "lucide-react";
import { IndividualPlans } from "@/components/IndividualPlans";
import { PageHero } from "@/components/page/PageHero";
import { PriceMock } from "@/components/page/Visuals";
import { CREDIT_BANDS, EDUCATION_DISCOUNT, LICENCE_BANDS, PILOT, money } from "@/lib/prices";
import { app } from "@/lib/site";
import { TESTS } from "@/lib/tests";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Spica pricing for individuals and organisations: free placement test, Full access by the month, single tests, learner licences and credits for tests and recruitment.",
};

const FAQ: [string, string][] = [
  ["Which currency are prices in?", "US dollars, for everyone, India included. In India, 18% GST is added."],
  ["How do I pay?", "By card, in US dollars, in every country. Organisations on Business and Enterprise can also pay by invoice and purchase order."],
  ["Is tax included?", "Prices are before tax. In India, 18% GST is added; elsewhere, other taxes as the law requires."],
  ["Can I cancel a monthly subscription?", "Yes, at any time in Plans. You keep Full access to the end of the month you paid for and are not charged again."],
  ["Can I get a refund?", "A purchase you have not started using can be refunded within 14 days. Time already used and months not yet used are not refunded; the monthly subscription is the flexible option. A test that a fault on our side stopped can be taken again or refunded. Full rules are in the Terms."],
  ["Do unused credits come back?", "Yes. Credits for invitations that expire unused, and for tests stopped before the first question, go back to your balance."],
];

export default function PricingPage() {
  return (
    <>
      <PageHero
        crumbs={[{ label: "Pricing" }]}
        eyebrow="Pricing"
        icon={<CreditCard size={16} />}
        tone="moss"
        title={
          <>
            Simple prices, <span className="ph-accent">nothing renews by surprise</span>
          </>
        }
        lead="Start free. Pay for a single test, a month of everything, or licences and credits for your organisation."
        actions={
          <>
            <a className="btn primary" href="#individuals">
              For individuals <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a className="btn ghost" href="#organisations">
              For organisations
            </a>
          </>
        }
        visual={<PriceMock />}
      />
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <Compass size={14} /> Choose
            </p>
            <h2>Which plan is right for you?</h2>
            <p className="muted">Start from what you want to achieve. You can always start free and move up later.</p>
          </div>
          <div className="grid g4 goals">
            {[
              ["I want to know my level", "A free placement test gives your level for each skill, plus practice every week.", "Free", app.signUp, "Start free"],
              ["I need a certificate soon", "Take one real test with a score report and a certificate anyone can check.", `from ${money("assessment:placement", "USD")}`, "#individuals", "See single tests"],
              ["I want to pass one test", "30 days of practice and mock tests for that test, then the real test.", `from ${money("prep:placement", "USD")}`, "#individuals", "See preparation"],
              ["I want to improve overall", "Every main test, unlimited practice tests, mock tests and a final assessment.", `${money("full", "USD")} a month`, "#individuals", "See Full access"],
            ].map(([h, d, price, href, cta]) => (
              <a className="card goal" href={href} key={h} data-reveal>
                <h3>{h}</h3>
                <p className="muted">{d}</p>
                <span className="path-tag">{price}</span>
                <span className="goal-cta">
                  {cta} <ArrowRight size={15} aria-hidden="true" />
                </span>
              </a>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 14 }}>
            Buying for a team? <a href="#organisations">See licences and credits for organisations</a>.
          </p>

          <div className="table-wrap" style={{ marginTop: 32 }} data-reveal>
            <table className="t compare">
              <thead>
                <tr>
                  <th />
                  <th>Free</th>
                  <th>Preparation + test</th>
                  <th>Full access</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Tests covered", "Try any test", "One test of your choice", "All five main tests"],
                    ["Placement test with a level for each skill", true, true, true],
                    ["Practice tests", "2 a month", "Unlimited, for that test", "Unlimited"],
                    ["Mock tests under real conditions", "1 a month", "2 a month, for that test", "2 a month in each test"],
                    ["Score reports", "Summary", "Full", "Full"],
                    ["Real test with a certificate", false, "That test", "One final assessment"],
                    ["Price", "Free", `from ${money("prep:placement", "USD")}`, `${money("full", "USD")} a month`],
                  ] as [string, string | boolean, string | boolean, string | boolean][]
                ).map(([row, ...cells]) => (
                  <tr key={row}>
                    <td>
                      <b>{row}</b>
                    </td>
                    {cells.map((c, i) => (
                      <td key={i}>
                        {c === true ? <Check size={18} className="yes" aria-label="Included" /> : c === false ? <X size={18} className="no" aria-label="Not included" /> : c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: "0.88rem" }}>
            One month of Full access includes up to 10 mock tests: 2 in each of the five main tests. Level Tests (A1–C2) are bought separately.
          </p>
        </div>
      </section>

      <section className="section alt" id="individuals">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <User size={14} /> For individuals
            </p>
            <h2>Learn, practise and get certified</h2>
          </div>
          <IndividualPlans />
        </div>
      </section>

      <section className="section alt" id="organisations">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <Building2 size={14} /> For organisations
            </p>
            <h2>Licences for learners, credits for tests</h2>
          </div>
          <p className="lead">
            Companies, universities and training providers buy <b>learner licences</b>. Recruiters and anyone giving single tests use{" "}
            <b>credits</b>. Prices in US dollars.
          </p>
          <div className="grid g3" style={{ marginTop: 28 }}>
            {LICENCE_BANDS.map((b) => (
              <div key={b.tier} className={`card plan${b.tier === "Business" ? " featured" : ""}`} data-reveal>
                <h3>{b.tier}</h3>
                <div className="price">
                  US${b.usd} <small>per learner-month</small>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                  {b.from === 1 ? "Any number of licences" : `${b.from}+ licences in one purchase`}
                </p>
                <ul className="ticks">
                  {b.tier === "Starter" && (
                    <>
                      <li>Full access for every learner</li>
                      <li>Up to 3 managers and 5 batches</li>
                      <li>Reports by person and batch</li>
                      <li>Certificates from the final assessment</li>
                    </>
                  )}
                  {b.tier === "Business" && (
                    <>
                      <li>Everything in Starter</li>
                      <li>Unlimited managers and batches</li>
                      <li>Manager licence pools and requests</li>
                      <li>Audit log and scheduled reports</li>
                      <li>Secure proctoring</li>
                      <li>Invoice and purchase order</li>
                    </>
                  )}
                  {b.tier === "Enterprise" && (
                    <>
                      <li>Everything in Business</li>
                      <li>Company sign-in (SSO) and automatic accounts (SCIM)</li>
                      <li>API and webhooks</li>
                      <li>Required two-step sign-in and IP limits</li>
                      <li>Data governance controls</li>
                      <li>Dedicated account manager</li>
                    </>
                  )}
                </ul>
                <Link className={`btn ${b.tier === "Business" ? "primary" : "ghost"}`} href="/contact">
                  {b.tier === "Enterprise" ? "Talk to us" : "Get started"}
                </Link>
              </div>
            ))}
          </div>
          <div className="perks" data-reveal>
            <div>
              <User size={20} />
              <span>One licence gives one learner Full access for one month, including a final assessment with a certificate.</span>
            </div>
            <div>
              <GraduationCap size={20} />
              <span>Universities and colleges: {EDUCATION_DISCOUNT}% off.</span>
            </div>
            <div>
              <Rocket size={20} />
              <span>
                Pilot: {PILOT.licences} licences for {PILOT.days} days to try Spica with your team.
              </span>
            </div>
          </div>

          <h3 style={{ marginTop: 40 }}>Credits for tests and recruitment</h3>
          <div className="grid g2">
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Credits bought at once</th>
                    <th>Price per credit</th>
                  </tr>
                </thead>
                <tbody>
                  {CREDIT_BANDS.map((b, i) => (
                    <tr key={b.from}>
                      <td>{CREDIT_BANDS[i + 1] ? `${b.from}–${CREDIT_BANDS[i + 1].from - 1}` : `${b.from}+`}</td>
                      <td>US${b.usd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Credits per person</th>
                  </tr>
                </thead>
                <tbody>
                  {TESTS.map((t) => (
                    <tr key={t.slug}>
                      <td>{t.name}</td>
                      <td>{t.credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap faq" style={{ maxWidth: 820 }}>
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Questions</p>
            <h2>Billing questions</h2>
          </div>
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
