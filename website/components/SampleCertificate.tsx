import { app } from "@/lib/site";

// A picture of a certificate with made-up details, linking to the live sample.
export function SampleCertificate() {
  const skills: [string, number][] = [
    ["Speaking", 67],
    ["Listening", 66],
    ["Reading", 49],
    ["Writing", 48],
  ];
  return (
    <a className="cert" href={app.sampleCertificate} style={{ textDecoration: "none", color: "inherit" }} aria-label="Open the sample certificate">
      <div className="cert-top">
        <b>Spica</b>
        <span>English 4 Skills Essentials</span>
      </div>
      <div className="cert-name">Sample Candidate</div>
      <div className="muted" style={{ fontSize: "0.86rem" }}>
        Certificate of English level
      </div>
      <div className="cert-level">
        <strong>B2</strong>
        <div>
          <div style={{ fontWeight: 600 }}>Spica score 58</div>
          <div className="muted" style={{ fontSize: "0.82rem" }}>
            CEFR level, out of 90
          </div>
        </div>
      </div>
      <div className="bars">
        {skills.map(([s, v]) => (
          <div className="bar-row" key={s}>
            <span>{s}</span>
            <span>
              <i style={{ width: `${((v - 10) / 80) * 100}%` }} />
            </span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <div className="cert-foot">
        <span>Identity verified · Proctored</span>
        <span>Check: SPC-…-SAMPLE</span>
      </div>
    </a>
  );
}
