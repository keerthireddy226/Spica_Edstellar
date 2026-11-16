"use client";

import { useState } from "react";
import { app } from "@/lib/site";

// Sends the visitor to the app's public check page for the code they enter.
export function CertificateForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim().toUpperCase();
        if (!/^[A-Z0-9-]{6,40}$/.test(c)) {
          setError("Enter the code exactly as it appears on the certificate, for example SPC-AB12-CD34-EF56.");
          return;
        }
        window.location.href = app.certificateCheck(c);
      }}
    >
      <label htmlFor="code" className="muted" style={{ display: "block", marginBottom: 8 }}>
        Certificate code
      </label>
      <div className="field">
        <input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="SPC-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} />
        <button className="btn primary" type="submit">
          Check certificate
        </button>
      </div>
      {error && (
        <p role="alert" style={{ color: "#a83a32", marginTop: 10 }}>
          {error}
        </p>
      )}
    </form>
  );
}
