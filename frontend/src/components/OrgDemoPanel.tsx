import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { api } from "@/lib/api";
import { tr } from "@/i18n/tr";

// Org Admin of a Channel Partner's organisation: the demo licences, and which
// learners have one. New learners get one automatically while any are left;
// a licence can be taken back from a learner who hasn't started a test.
interface Data {
  partnerOrganisation: boolean;
  demo?: { given: number; used: number; left: number; windowOpen: boolean; windowEndsAt: string | null; days: number };
  learners?: { id: string; name: string; email: string; demoEndsAt: string | null; status: "none" | "active" | "ended"; started: boolean; paid?: boolean }[];
  upgrade?: { demoLearners: number; paidLicencesFree: number; licenceMonths: number };
}
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");

export function OrgDemoPanel() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = () => api<Data>("/org-demo").then(setD).catch(() => setD(null));
  useEffect(() => {
    load();
  }, []);
  if (!d?.partnerOrganisation || !d.demo) return null;
  const act = async (id: string, method: "POST" | "DELETE") => {
    setBusy(id);
    setErr(null);
    try {
      await api(`/org-demo/${id}`, { method });
      await load();
    } catch (e) {
      const m = String((e as Error).message ?? "");
      setErr(m.includes("demo_already_used") ? tr("This learner has already started a test, so the licence can't be taken back.") : m.includes("no_demo_licences_left") ? tr("No demo licences left. Ask your partner for more.") : m.includes("demo_window_not_open") ? tr("The demo period has ended. Contact your partner.") : tr("That didn't work. Try again."));
    } finally {
      setBusy(null);
    }
  };
  const x = d.demo;
  const up = d.upgrade;
  const upgrade = async () => {
    setBusy("upgrade");
    setErr(null);
    try {
      const r = await api<{ upgraded: number; left: number }>("/org-demo/upgrade", { method: "POST" });
      setNote(r.left ? tr("{{n}} demo learners now have a paid licence. {{l}} still need one: add licences and try again.", { n: r.upgraded, l: r.left }) : tr("{{n}} demo learners now have a paid licence. Their practice history stays.", { n: r.upgraded }));
      await load();
    } catch {
      setErr(tr("That didn't work. Try again."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-bold text-lg flex items-center gap-2">
          <Gift size={18} className="text-navy" /> {tr("Demo licences")}
        </h2>
        <span className="text-sm">
          <b>{tr("{{used}} of {{given}} used", { used: x.used, given: x.given })}</b> · {tr("{{n}} left", { n: x.left })}
          {x.windowEndsAt ? ` · ${x.windowOpen ? tr("give them out by {{d}}", { d: day(x.windowEndsAt) }) : tr("demo period ended")}` : ""}
        </span>
      </div>
      <p className="text-sm text-muted">
        {tr("Each learner you add gets a {{n}}-day demo of English 4 Skills Essentials automatically: Practice Modules, 2 practice tests and 1 mock test. There is no final assessment or certificate in the demo.", { n: x.days })}
      </p>
      {up && up.demoLearners > 0 && up.paidLicencesFree > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border border-rule rounded-input p-3 text-sm">
          <span>{tr("{{n}} demo learners can move to paid licences ({{m}} months each). {{f}} paid licences are free.", { n: up.demoLearners, m: up.licenceMonths, f: up.paidLicencesFree })}</span>
          <button className="font-semibold text-navy cursor-pointer disabled:opacity-40" disabled={busy === "upgrade"} onClick={upgrade}>
            {tr("Give them paid licences")}
          </button>
        </div>
      )}
      {note && <p className="text-sm text-success">{note}</p>}
      {err && <p className="text-sm text-error">{err}</p>}
      {d.learners && d.learners.length > 0 && (
        <ul className="flex flex-col divide-y divide-rule border border-rule rounded-input">
          {d.learners.slice(0, 50).map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <b>{l.name || l.email}</b> <span className="text-muted">{l.email}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-muted">{l.paid ? tr("Moved to a paid licence") : l.status === "active" ? tr("Demo until {{d}}", { d: day(l.demoEndsAt) }) : l.status === "ended" ? tr("Demo ended") : tr("No demo licence")}</span>
                {l.status === "none" && !l.paid && (
                  <button className="font-semibold text-navy cursor-pointer disabled:opacity-40" disabled={busy === l.id || x.left <= 0 || !x.windowOpen} onClick={() => act(l.id, "POST")}>
                    {tr("Give a demo licence")}
                  </button>
                )}
                {l.status === "active" && !l.started && (
                  <button className="font-semibold text-muted hover:text-ink cursor-pointer" disabled={busy === l.id} onClick={() => act(l.id, "DELETE")}>
                    {tr("Take back")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
