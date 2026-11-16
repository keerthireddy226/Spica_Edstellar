"use client";

import { useState } from "react";
import { CURRENCIES, type Currency, money } from "@/lib/prices";
import { app } from "@/lib/site";
import { TESTS } from "@/lib/tests";

// Individual plans with a currency switch. Prices come from lib/prices.ts.
export function IndividualPlans() {
  const [c, setC] = useState<Currency>("INR");
  const tests = TESTS.filter((t) => t.id !== "level");
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, margin: "8px 0 24px" }}>
        <p className="muted" style={{ margin: 0 }}>
          Prices before tax. GST is added in India.
        </p>
        <div className="tabs" role="group" aria-label="Currency">
          {CURRENCIES.map((x) => (
            <button key={x} type="button" aria-pressed={x === c} onClick={() => setC(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>

      <div className="grid g3">
        <div className="card plan">
          <h3>Free</h3>
          <div className="price">{money("free", c)}</div>
          <ul className="ticks">
            <li>One placement test with a level for each skill</li>
            <li>3 practice sessions a week</li>
            <li>2 practice tests and 1 mock test a month</li>
            <li>Summary reports</li>
          </ul>
          <a className="btn ghost" href={app.signUp}>
            Start free
          </a>
        </div>
        <div className="card plan featured">
          <span className="pill clay" style={{ alignSelf: "flex-start" }}>
            Most complete
          </span>
          <h3>Full access</h3>
          <div className="price">
            {money("full", c)} <small>a month</small>
          </div>
          <ul className="ticks">
            <li>All six tests, every Practice Module</li>
            <li>Unlimited practice tests</li>
            <li>2 mock tests a month in each test</li>
            <li>Full progress and score reports</li>
            <li>One final assessment with a certificate</li>
          </ul>
          <p className="muted" style={{ fontSize: "0.88rem", margin: 0 }}>
            One month at a time: buy another month when you need it, or subscribe monthly and cancel any time.
          </p>
          <a className="btn primary" href={app.signUp}>
            Get Full access
          </a>
        </div>
        <div className="card plan">
          <h3>One test</h3>
          <div className="price">
            <small>from</small> {money("assessment:placement", c)}
          </div>
          <ul className="ticks">
            <li>A real, proctored test with a score report and certificate</li>
            <li>A free sample first, with the same checks</li>
            <li>Or preparation + test: 30 days of practice for that test, then the real test</li>
          </ul>
          <a className="btn ghost" href={app.signUp}>
            Choose a test
          </a>
        </div>
      </div>

      <h3 style={{ marginTop: 40 }}>Single tests</h3>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Test</th>
              <th>Real test only</th>
              <th>Preparation + test (30 days)</th>
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.slug}>
                <td>{t.name}</td>
                <td>{money(t.priceKey, c)}</td>
                <td>{t.prepKey ? money(t.prepKey, c) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 40 }}>Other options</h3>
      <div className="table-wrap">
        <table className="t">
          <tbody>
            <tr>
              <td>
                <b>Level Test</b> (A1–C2)
              </td>
              <td>{money("level", c)}</td>
              <td>Passed or not passed at one level. No certificate.</td>
            </tr>
            <tr>
              <td>
                <b>Practice pack</b>
              </td>
              <td>{money("pack", c)}</td>
              <td>30 days of Practice Modules in every question type, toward a level you choose.</td>
            </tr>
            <tr>
              <td>
                <b>Certificate: 12 more months</b>
              </td>
              <td>{money("certExtend", c)}</td>
              <td>Certificates are valid for 12 months; extend once the test is done.</td>
            </tr>
            <tr>
              <td>
                <b>Certificate: lifetime</b>
              </td>
              <td>{money("certLifetime", c)}</td>
              <td>The certificate never expires.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
