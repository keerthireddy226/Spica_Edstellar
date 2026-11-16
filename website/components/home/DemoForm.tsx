"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

// Demo request. Posts FormData to Edstellar's form system at
// NEXT_PUBLIC_FORM_ENDPOINT (set by Edstellar's web team). The hidden
// "website" field is a trap for spam robots.
const ENDPOINT = process.env.NEXT_PUBLIC_FORM_ENDPOINT || "";

export function DemoForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (!String(data.get("email") || "").match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return setErr("Enter a valid work email.");
    if (!data.get("consent")) return setErr("Please tick the box so we can reply to you.");
    setErr(null);
    if (data.get("website")) return setState("done");
    data.set("platform", "spica");
    data.set("source", "spica-website");
    if (!ENDPOINT) return setErr("Demo requests are not connected yet: Edstellar's form system is linked before launch.");
    setState("sending");
    try {
      const r = await fetch(ENDPOINT, { method: "POST", body: data });
      setState(r.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }
  if (state === "done")
    return (
      <div className="h-done" role="status">
        <CheckCircle2 size={36} />
        <h3>Thank you, we&apos;ve got your request</h3>
        <p>An Edstellar specialist will reply within one business day to arrange your demo.</p>
      </div>
    );
  return (
    <form className="h-form" onSubmit={submit} noValidate>
      <div className="h-form-grid">
        <label>
          Full name
          <input name="name" required autoComplete="name" />
        </label>
        <label>
          Work email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Company or institution
          <input name="company" required autoComplete="organization" />
        </label>
        <label>
          Job title
          <input name="title" autoComplete="organization-title" />
        </label>
        <label>
          I&apos;m interested in
          <select name="interest" defaultValue="">
            <option value="" disabled>
              Choose one
            </option>
            <option>Testing and training employees</option>
            <option>Testing job candidates</option>
            <option>Admissions or student placement</option>
            <option>Training courses we run</option>
            <option>Something else</option>
          </select>
        </label>
        <label>
          People to test or train
          <select name="size" defaultValue="">
            <option value="" disabled>
              Choose one
            </option>
            <option>Under 50</option>
            <option>50–249</option>
            <option>250–999</option>
            <option>1,000 or more</option>
          </select>
        </label>
        <label className="h-span2">
          What would you like to achieve? (optional)
          <textarea name="message" rows={3} placeholder="For example: we hire 200 support agents a month and need to check spoken English before interviews." />
        </label>
        <input name="website" tabIndex={-1} autoComplete="off" className="h-trap" aria-hidden="true" />
      </div>
      <label className="h-consent">
        <input type="checkbox" name="consent" value="yes" />
        <span>
          I agree that Edstellar may use these details to reply to my request, as described in the <a href="/legal/privacy">privacy policy</a>.
        </span>
      </label>
      {err && (
        <p className="h-err" role="alert">
          {err}
        </p>
      )}
      {state === "error" && (
        <p className="h-err" role="alert">
          Something went wrong. Please try again in a moment.
        </p>
      )}
      <div className="h-form-foot">
        <button className="h-btn primary" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Book my demo"}
        </button>
        <small>We reply within one business day.</small>
      </div>
    </form>
  );
}
