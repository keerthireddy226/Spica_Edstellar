import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { tr } from "@/i18n/tr";
import { Button } from "@/components/Button";

// An individual learner can enter an Affiliate Partner's code once (if they
// didn't at sign-up). The partner sees only counts and amounts, never who.
export function PartnerCodeBox() {
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ code: string | null }>("/me/partner-code")
      .then((r) => setCurrent(r.code))
      .catch(() => setCurrent(null));
  }, []);
  if (current === undefined) return null;
  if (current) return <p className="text-xs text-muted">{tr("Partner code used: {{c}}", { c: current })}</p>;
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api("/me/partner-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
      setCurrent(code.trim().toUpperCase());
    } catch (e) {
      const m = String((e as Error).message ?? "");
      setMsg({ ok: false, text: m.includes("individuals_only") ? tr("Partner codes are for people buying for themselves.") : tr("That code isn't valid or the partnership has ended.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{tr("Have a partner code?")}</span>
        <input className="rounded-input border border-rule bg-surface px-3 py-1.5 text-sm font-mono uppercase w-40 focus:outline-none focus:border-navy" value={code} maxLength={20} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AF-XXXXXX" />
      </label>
      <Button variant="secondary" disabled={busy || code.trim().length < 4} onClick={save}>
        {tr("Apply")}
      </Button>
      {msg && <span className={msg.ok ? "text-success" : "text-error"}>{msg.text}</span>}
    </div>
  );
}
