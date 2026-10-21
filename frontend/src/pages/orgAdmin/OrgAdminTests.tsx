import { useEffect, useMemo, useState } from "react";
import { Award, Coins, Send } from "lucide-react";
import { Button } from "@/components/Button";
import { getBatches, getOrgLearners, type OrgBatch, type OrgLearner } from "@/api/orgAdmin";
import { getOrgTests, giveTests, requestCredits, withdrawTest, type GivenStatus, type OrgTests } from "@/api/orgTests";
import { ApiError } from "@/lib/api";
import { tr } from "@/i18n/tr";

// Tests & credits: give learners a real test (strictly proctored, with a
// certificate), a level test, or preparation for one test, paid with the
// organization's credits. Full access stays on the Licenses page. Programs
// with a final assessment give theirs here automatically.

const day = (iso: string) => new Date(iso).toLocaleDateString(document.documentElement.lang || undefined, { day: "numeric", month: "short", year: "numeric" });

const STATUS: Record<GivenStatus, { label: () => string; cls: string }> = {
  waiting: { label: () => tr("Not started"), cls: "text-navy-deep" },
  in_progress: { label: () => tr("In progress"), cls: "text-navy-deep" },
  taken: { label: () => tr("Taken, being scored"), cls: "text-warning" },
  certified: { label: () => tr("Certified"), cls: "text-success" },
  passed: { label: () => tr("Passed"), cls: "text-success" },
  not_passed: { label: () => tr("Not passed"), cls: "text-warning" },
  expired: { label: () => tr("Expired"), cls: "text-muted" },
  expired_refunded: { label: () => tr("Expired, credits returned"), cls: "text-muted" },
  withdrawn: { label: () => tr("Withdrawn"), cls: "text-muted" },
};

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
// Kinds that are one test (not months of access).
const oneTest = (kind: string) => kind === "assessment" || kind === "level";

const input = "rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink";

export function OrgAdminTests() {
  const [data, setData] = useState<OrgTests | null>(null);
  const [learners, setLearners] = useState<OrgLearner[]>([]);
  const [batches, setBatches] = useState<OrgBatch[]>([]);
  const [productId, setProductId] = useState("");
  const [periods, setPeriods] = useState(1);
  const [level, setLevel] = useState("B1");
  const [packLevel, setPackLevel] = useState("");
  const [who, setWho] = useState<"batch" | "learners">("learners");
  const [batchId, setBatchId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [askQty, setAskQty] = useState("50");

  function load() {
    getOrgTests().then(setData);
  }
  useEffect(() => {
    load();
    getOrgLearners().then((r) => setLearners(r.learners));
    getBatches().then((r) => setBatches(r.batches));
  }, []);

  const product = data?.products.find((p) => p.id === productId) ?? null;
  const count = who === "batch" ? learners.filter((l) => l.batchId === batchId).length : picked.size;
  const each = product ? product.credits * (oneTest(product.kind) ? 1 : periods) : 0;
  const total = each * count;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return learners.filter((l) => !q || [l.firstName, l.lastName, l.email, l.participantId].some((x) => x?.toLowerCase().includes(q))).slice(0, 200);
  }, [learners, search]);

  async function give() {
    if (!product) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await giveTests({
        productId: product.id,
        periods: oneTest(product.kind) ? undefined : periods,
        level: product.kind === "level" ? level : product.kind === "pack" ? packLevel || undefined : undefined,
        ...(who === "batch" ? { batchId } : { userIds: [...picked] }) });
      setNote({ ok: true, text: r.given === 1 ? tr("Given to 1 learner. {{c}} credits used.", { c: r.creditsUsed }) : tr("Given to {{n}} learners. {{c}} credits used.", { n: r.given, c: r.creditsUsed }) });
      setPicked(new Set());
      load();
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as { error?: string; needed?: number; balance?: number }) : null;
      setNote({ ok: false, text: b?.error === "not_enough_credits" ? tr("Not enough credits: this needs {{n}}, you have {{b}}.", { n: b.needed ?? total, b: b.balance ?? 0 }) : tr("Couldn't give the test. Try again.") });
    } finally {
      setBusy(false);
    }
  }
  async function ask() {
    const n = Number(askQty);
    if (!n) return;
    await requestCredits(n).catch(() => null);
    setNote({ ok: true, text: tr("Request sent to your Spica contact for {{n}} credits.", { n }) });
  }

  if (!data) return <p className="text-sm text-muted">{tr("Loading…")}</p>;
  const groups = [
    { kind: "assessment" as const, label: tr("Real test (with a certificate)") },
    { kind: "level" as const, label: tr("Level test (no certificate)") },
    { kind: "prep" as const, label: tr("Prepare for one test, then a real test") },
    { kind: "pack" as const, label: tr("Practice pack (Practice Modules only)") },
  ];
  return (
    <div className="flex flex-col gap-5 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{tr("Tests & credits")}</h1>
        <p className="text-sm text-muted mt-1">{tr("Give your people a real, strictly proctored test with a certificate, a level test, or a month of preparation for one test. Paid with credits; Full access stays on Licenses.")}</p>
      </div>

      <section className="bg-surface border border-rule rounded-card p-5 flex flex-wrap items-center gap-4">
        <span className="h-12 w-12 rounded-2xl bg-navy/15 text-navy-deep flex items-center justify-center">
          <Coins size={24} />
        </span>
        <div className="flex-1 min-w-[200px]">
          <p className="font-display font-bold text-2xl text-ink tabular-nums">{tr("{{n}} credits", { n: data.balance })}</p>
          <p className="text-xs text-muted">{tr("The same credits pay for recruitment invitations. A real test or level test that expires unused gives its credits back.")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" min={1} value={askQty} onChange={(e) => setAskQty(e.target.value)} className={`${input} w-24`} aria-label={tr("Credits")} />
          <Button variant="secondary" onClick={ask} className="!py-2">
            {tr("Ask for more credits")}
          </Button>
        </div>
      </section>

      <section className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-4">
        <h2 className="font-display font-semibold text-lg text-ink flex items-center gap-2">
          <Send size={18} /> {tr("Give a test")}
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink">
            {tr("Test")}
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={input}>
              <option value="">{tr("Choose a test")}</option>
              {groups.map((g) => (
                <optgroup key={g.kind} label={g.label}>
                  {data.products
                    .filter((p) => p.kind === g.kind)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {`${p.testName ?? (p.kind === "level" ? tr("Any level, A1 to C2") : p.name)} · ${
                          oneTest(p.kind)
                            ? p.credits === 1
                              ? tr("1 credit")
                              : tr("{{n}} credits", { n: p.credits })
                            : p.credits === 1
                              ? tr("1 credit a month")
                              : tr("{{n}} credits a month", { n: p.credits })
                        }`}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          {product?.kind === "level" && (
            <label className="flex flex-col gap-1 text-sm text-ink">
              {tr("Level")}
              <select value={level} onChange={(e) => setLevel(e.target.value)} className={input}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">{tr("Checks one level: a pass is 70% overall and at least 50% in each skill. No certificate; certificates come from the final assessment. Unused tests give their credit back.")}</span>
            </label>
          )}
          {product?.kind === "pack" && (
            <label className="flex flex-col gap-1 text-sm text-ink">
              {tr("Level to aim for")}
              <select value={packLevel} onChange={(e) => setPackLevel(e.target.value)} className={input}>
                <option value="">{tr("Keep each learner's goal")}</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {product && !oneTest(product.kind) && (
            <label className="flex flex-col gap-1 text-sm text-ink">
              {tr("Months")}
              <select value={periods} onChange={(e) => setPeriods(Number(e.target.value))} className={input}>
                {[1, 2, 3, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex gap-2">
          {(["learners", "batch"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWho(w)}
              className={`px-3.5 py-1.5 rounded-pill text-sm font-semibold border cursor-pointer ${who === w ? "bg-navy text-white border-navy" : "border-rule text-ink"}`}
            >
              {w === "learners" ? tr("Choose learners") : tr("A whole batch")}
            </button>
          ))}
        </div>
        {who === "batch" ? (
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={`${input} max-w-sm`}>
            <option value="">{tr("Choose a batch")}</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex flex-col gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Search by name, email or ID")} className={`${input} max-w-sm`} />
            <div className="max-h-64 overflow-y-auto border border-rule rounded-xl divide-y divide-rule">
              {shown.map((l) => (
                <label key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-paper-warm/50">
                  <input
                    type="checkbox"
                    checked={picked.has(l.id)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(l.id);
                        else n.delete(l.id);
                        return n;
                      })
                    }
                    className="h-4 w-4 accent-navy"
                  />
                  <span className="font-semibold text-ink">{[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email}</span>
                  <span className="text-xs text-muted">{[l.participantId, l.batchName].filter(Boolean).join(" · ")}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
          <p className="text-sm text-ink flex-1">
            {product && count > 0
              ? tr("{{n}} learners × {{k}} credits = {{t}} credits ({{b}} left after).", { n: count, k: each, t: total, b: data.balance - total })
              : tr("Choose a test and who gets it.")}
          </p>
          <Button onClick={give} disabled={busy || !product || count === 0 || total > data.balance}>
            {busy ? tr("Giving…") : tr("Give the test")}
          </Button>
        </div>
        {note && <p className={`text-sm ${note.ok ? "text-success" : "text-error"}`}>{note.text}</p>}
      </section>

      <section className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-3">
        <h2 className="font-display font-semibold text-lg text-ink flex items-center gap-2">
          <Award size={18} /> {tr("Tests given")}
        </h2>
        {data.given.length === 0 ? (
          <p className="text-sm text-muted">{tr("No tests given yet.")}</p>
        ) : (
          <div className="overflow-x-auto border border-rule rounded-xl">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="bg-paper-warm/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">{tr("Learner")}</th>
                  <th className="px-3 py-2">{tr("Test")}</th>
                  <th className="px-3 py-2">{tr("Given")}</th>
                  <th className="px-3 py-2">{tr("Until")}</th>
                  <th className="px-3 py-2">{tr("Credits")}</th>
                  <th className="px-3 py-2">{tr("Status")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.given.map((g) => (
                  <tr key={g.id} className="border-t border-rule">
                    <td className="px-3 py-2">
                      <span className="font-semibold text-ink">{g.learner}</span>
                      {g.participantId && <span className="block text-xs text-muted font-mono">{g.participantId}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {g.kind === "level" && g.testLevel ? tr("Level {{level}} test", { level: g.testLevel }) : g.name}
                      {g.programName && <span className="block text-xs text-muted">{tr("Final assessment: {{program}}", { program: g.programName })}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink whitespace-nowrap">{day(g.givenAt)}</td>
                    <td className="px-3 py-2 text-ink whitespace-nowrap">{day(g.endsAt)}</td>
                    <td className="px-3 py-2 tabular-nums text-ink">{g.credits}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill border border-current whitespace-nowrap ${STATUS[g.status].cls}`}>{STATUS[g.status].label()}</span>
                      {g.status === "certified" && g.score !== null && <span className="block text-xs text-muted mt-1">{tr("Spica score {{score}} · {{level}}", { score: g.score, level: g.level ?? "—" })}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {g.certificate && (
                        <a href={`/certificate/${g.certificate}`} target="_blank" rel="noopener" className="text-sm font-semibold text-navy-deep hover:underline">
                          {tr("Certificate")}
                        </a>
                      )}
                      {g.status === "waiting" && (
                        <button
                          onClick={() => withdrawTest(g.id).then(load)}
                          className="text-sm font-semibold text-error hover:underline cursor-pointer"
                        >
                          {oneTest(g.kind) ? tr("Withdraw (credits back)") : tr("Withdraw")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
