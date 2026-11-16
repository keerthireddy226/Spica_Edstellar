"use client";

import { useEffect, useState } from "react";
import { company } from "@/lib/site";

// No server: the form opens the visitor's own email app with the message
// filled in, addressed to sales or support. Replace with a form service later.
const TOPICS: Record<string, { label: string; to: string }> = {
  demo: { label: "Book a demo", to: company.salesEmail },
  sales: { label: "Pricing or a quote for my organisation", to: company.salesEmail },
  support: { label: "Help with my account or a test", to: company.supportEmail },
  privacy: { label: "Privacy or my data", to: company.privacyEmail },
};

export function ContactForm() {
  const [topic, setTopic] = useState("demo");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("topic");
    if (t && TOPICS[t]) setTopic(t);
  }, []);
  const ready = !TOPICS[topic].to.startsWith("[");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = `${msg}\n\nName: ${name}\nOrganisation: ${org}`;
        window.location.href = `mailto:${TOPICS[topic].to}?subject=${encodeURIComponent(`Spica: ${TOPICS[topic].label}`)}&body=${encodeURIComponent(body)}`;
      }}
      style={{ display: "grid", gap: 14 }}
    >
      <label>
        <span className="muted">What can we help with?</span>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} style={inputStyle}>
          {Object.entries(TOPICS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="muted">Your name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </label>
      <label>
        <span className="muted">Organisation (optional)</span>
        <input value={org} onChange={(e) => setOrg(e.target.value)} style={inputStyle} />
      </label>
      <label>
        <span className="muted">Message</span>
        <textarea required rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} style={inputStyle} />
      </label>
      <button className="btn primary" type="submit" disabled={!ready} style={{ justifySelf: "start" }}>
        Write to us
      </button>
      {!ready && (
        <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
          The contact addresses are being set up.
        </p>
      )}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 6,
  padding: "12px 14px",
  font: "inherit",
  border: "1px solid var(--rule)",
  borderRadius: 12,
  background: "var(--surface)",
  color: "var(--ink)",
};
