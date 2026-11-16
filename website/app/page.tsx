import { app } from "@/lib/site";

// Placeholder until step 2 builds the full home page.
export default function Home() {
  return (
    <section className="section">
      <div className="wrap">
        <p className="eyebrow">English tests, practice and certificates</p>
        <h1>
          Know your English level.
          <br />
          <span style={{ color: "var(--clay-deep)" }}>Improve it. Prove it.</span>
        </h1>
        <p className="muted" style={{ maxWidth: 620, fontSize: "1.1rem" }}>
          One platform to learn, practise and certify English in all four skills. Every journey ends with a proctored test and a certificate
          anyone can check online.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
          <a className="btn primary" href={app.signUp}>
            Start free
          </a>
          <a className="btn ghost" href="/demo">
            Book a demo
          </a>
        </div>
      </div>
    </section>
  );
}
