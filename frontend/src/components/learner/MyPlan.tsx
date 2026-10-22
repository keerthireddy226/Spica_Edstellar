import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Award, BookOpen, ClipboardCheck } from "lucide-react";
import { getMyAccess, type MyAccess, type Owned } from "@/api/access";
import { getSwitchQuote, switchPrepTest, type SwitchQuote } from "@/api/assessment";
import { createSwitchOrder, formatAmount, getPriceList, startCheckout } from "@/api/payments";
import { formatShortDate } from "@/api/licenses";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

// What a learner owns besides a licence or the Plus plan: preparation for
// one test, a real test, a level test. Each says what it opens and until when.
export function useMyAccess(): MyAccess | null {
  const [a, setA] = useState<MyAccess | null>(null);
  useEffect(() => {
    getMyAccess()
      .then(setA)
      .catch(() => setA(null));
  }, []);
  return a;
}

function opens(o: Owned): string {
  if (o.kind === "prep") return tr("Practice tests, mock tests and Practice Modules for this test, then one real test with a certificate.");
  if (o.kind === "assessment") return tr("One real test, strictly proctored, with a score report and a certificate.");
  if (o.kind === "level") return tr("One level test at {{level}}, to check where you are.", { level: o.level ?? "—" });
  if (o.kind === "final") return tr("Your final assessment: one real test on the test you choose, with a certificate. Included with Full access.");
  if (o.kind === "pack") return tr("Practice Modules in every question type, aiming at {{level}}.", { level: o.level ?? "—" });
  return tr("Every test, mock test and Practice Module.");
}

// Preparation not started yet can move to another test, once, in its first 7
// days: free to a test that costs the same or less, else paying the difference.
function SwitchTest({ o }: { o: Owned }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tests, setTests] = useState<{ id: string; name: string }[]>([]);
  const [pick, setPick] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  // What the picked test costs; "org" when an organization gave this preparation and the test is dearer.
  const [q, setQ] = useState<SwitchQuote | "org" | "error" | null>(null);
  useEffect(() => {
    if (!pick) return;
    setQ(null);
    getSwitchQuote(o.id, pick)
      .then(setQ)
      .catch((e: Error) => setQ(e.message === "switch_needs_org" ? "org" : "error"));
  }, [o.id, pick]);
  useEffect(() => {
    if (!open || tests.length) return;
    getPriceList()
      .then((r) => {
        const t = r.products.filter((p) => p.kind === "prep" && p.testTypeId && p.testTypeId !== o.testTypeId).map((p) => ({ id: p.testTypeId!, name: p.testTypeName ?? p.name }));
        setTests(t);
        setPick(t[0]?.id ?? "");
      })
      .catch(() => {});
  }, [open, tests.length, o.testTypeId]);
  if (!o.canSwitchUntil) return null;
  if (state === "done")
    return (
      <span className="text-xs text-success">
        {tr("Switched. Reload to see your new test.")}{" "}
        <button onClick={() => window.location.reload()} className="font-semibold text-navy-deep hover:underline cursor-pointer">
          {tr("Reload")}
        </button>
      </span>
    );
  return open ? (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded-input border border-rule bg-surface px-2 py-1 text-xs">
        {tests.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {q === "org" ? (
        <span className="text-muted">{tr("Your organization chose this test. Ask your admin to change it.")}</span>
      ) : q === "error" ? (
        <span className="text-error">{tr("Prices couldn't load. Try again.")}</span>
      ) : q?.free === false ? (
        <>
          <span className="text-muted">{tr("Switching to {{test}} costs {{amount}} more.", { test: tests.find((t) => t.id === pick)?.name ?? "", amount: formatAmount(q.total, q.currency) })}</span>
          <button
            disabled={state === "busy"}
            onClick={async () => {
              setState("busy");
              try {
                await startCheckout(await createSwitchOrder(o.id, pick), navigate);
              } catch {
                setState("error");
              }
            }}
            className="font-semibold text-navy-deep hover:underline cursor-pointer disabled:opacity-50"
          >
            {tr("Pay and switch")}
          </button>
        </>
      ) : (
        <>
          {q?.free && <span className="text-muted">{tr("Free switch")}</span>}
          <button
            disabled={!pick || !q || state === "busy"}
            onClick={async () => {
              setState("busy");
              setState((await switchPrepTest(o.id, pick).then(() => true).catch(() => false)) ? "done" : "error");
            }}
            className="font-semibold text-navy-deep hover:underline cursor-pointer disabled:opacity-50"
          >
            {tr("Switch")}
          </button>
        </>
      )}
      {state === "error" && <span className="text-error">{tr("Couldn't switch. Try again.")}</span>}
    </span>
  ) : (
    <button onClick={() => setOpen(true)} className="self-start text-xs font-semibold text-navy-deep hover:underline cursor-pointer">
      {tr("Switch to another test (once, until {{date}})", { date: formatShortDate(o.canSwitchUntil) })}
    </button>
  );
}

export function OwnedList({ access }: { access: MyAccess }) {
  const items = access.owned.filter((o) => o.kind !== "full");
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((o) => {
        const Icon = o.kind === "prep" ? BookOpen : o.kind === "level" ? ClipboardCheck : Award;
        return (
          <div key={o.id} className="flex items-start gap-3 border border-rule rounded-xl px-3.5 py-3 bg-paper-warm/40">
            <span className="h-8 w-8 rounded-lg bg-navy/10 text-navy-deep flex items-center justify-center shrink-0">
              <Icon size={16} />
            </span>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold text-ink">{o.kind === "final" ? tr("Final assessment") : o.name}</span>
              <span className="text-xs text-muted">{opens(o)}</span>
              <span className="text-xs text-ink">
                {tr("Until {{date}}", { date: formatShortDate(o.endsAt) })}
                {o.kind !== "full" && o.kind !== "pack" &&
                  // A level test is a check, not a real test.
                  ` · ${o.kind === "level" ? (o.attemptsLeft === 1 ? tr("1 attempt left") : tr("{{n}} attempts left", { n: o.attemptsLeft })) : o.attemptsLeft === 1 ? tr("1 real test left") : tr("{{n}} real tests left", { n: o.attemptsLeft })}`}
              </span>
              <SwitchTest o={o} />
            </div>
          </div>
        );
      })}
      {access.attempts.length > 0 && (
        <Link to={ROUTES.MY_TESTS} className="self-start text-sm font-semibold text-navy-deep hover:underline">
          {tr("Go to Assessment")}
        </Link>
      )}
    </div>
  );
}
