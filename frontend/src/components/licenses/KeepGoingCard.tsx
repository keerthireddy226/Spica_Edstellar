import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CheckCircle2, Clock, Hourglass, Rocket, Send, XCircle } from "lucide-react";
import { Button } from "@/components/Button";
import { ROUTES } from "@/constants/routes";
import { formatShortDate, getKeepGoing, requestMoreTime, type KeepGoing, type KeepGoingReason } from "@/api/licenses";
import { tr } from "@/i18n/tr";

const ACCESS: KeepGoingReason[] = ["access_expired", "access_grace", "access_ending"];

// The situation in one or two sentences, most urgent first.
function situation(k: KeepGoing): string[] {
  const out: string[] = [];
  const r = new Set(k.reasons);
  if (r.has("access_expired")) out.push(tr("Your access ended on {{date}}. Your progress and reports are saved.", { date: formatShortDate(k.access.accessEndsAt) }));
  else if (r.has("access_grace")) out.push(tr("Your access ended on {{date}}; you can keep practising until {{grace}}.", { date: formatShortDate(k.access.accessEndsAt), grace: formatShortDate(k.access.graceEndsAt) }));
  else if (r.has("access_ending")) out.push(k.access.daysLeft === 1 ? tr("Your access ends tomorrow.") : tr("Your access ends in {{n}} days.", { n: k.access.daysLeft }));
  const used: string[] = [];
  if (r.has("quota_mocks")) used.push(tr("this month's mock tests"));
  if (r.has("quota_practice")) used.push(tr("this month's practice tests"));
  if (used.length) out.push(tr("You've used {{what}}; new ones on {{date}}.", { what: used.join(tr(" and ")), date: formatShortDate(k.quota?.resetsOn ?? null) }));
  if (r.has("tests_done")) out.push(tr("You've completed every practice test set."));
  if (r.has("exam_near") && k.goal.examDays !== null) out.push(k.goal.examDays === 0 ? tr("Your exam is today.") : tr("Your exam is in {{n}} days.", { n: k.goal.examDays }));
  return out;
}

// "Keep going": shown when the learner needs more time or tests to reach
// their goal. An individual extends from Plans; a learner in an organization
// asks their admin, and sees where the request stands.
export function KeepGoingCard() {
  const [k, setK] = useState<KeepGoing | null>(null);
  const [asking, setAsking] = useState(false);
  const [months, setMonths] = useState<1 | 3>(1);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    getKeepGoing()
      .then(setK)
      .catch(() => setK(null));
  useEffect(() => {
    void load();
  }, []);
  if (!k || !k.reasons.length || k.kind === "other") return null;

  const accessIssue = k.reasons.some((r) => ACCESS.includes(r));
  const expired = k.reasons.includes("access_expired");
  // An old decided request stops showing after two weeks.
  const req = k.request && (k.request.status === "pending" || (k.request.decidedAt && Date.now() - new Date(k.request.decidedAt).getTime() < 14 * 86_400_000)) ? k.request : null;
  const pending = req?.status === "pending";
  // More time helps when access runs out, every set is done or the exam is
  // close; a month's used-up tests come back on their own.
  const timeHelps = accessIssue || k.reasons.includes("tests_done") || k.reasons.includes("exam_near");

  async function send() {
    setSending(true);
    setError(null);
    try {
      await requestMoreTime(months, reason);
      setAsking(false);
      await load();
    } catch {
      setError(tr("The request couldn't be sent. Try again."));
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      className={`rounded-card border shadow-sm p-5 flex flex-col gap-3 ${expired ? "bg-error/5 border-error/30" : accessIssue ? "bg-warning/10 border-warning/30" : "bg-surface border-rule"}`}
    >
      {/* The button drops below the text when the card is narrow (beside the levels on Practice Tests). */}
      <div className="flex flex-wrap items-start gap-4">
        <span className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 ${expired ? "bg-error/15 text-error" : "bg-navy/10 text-navy-deep"}`}>
          {accessIssue ? <Hourglass size={22} /> : <Rocket size={22} />}
        </span>
        <div className="flex-1 basis-44 min-w-0 flex flex-col gap-1">
          <p className="font-display font-bold text-lg text-ink">
            {k.goal.current && k.goal.goal && !k.goal.reached
              ? tr("You're at {{level}}. Your goal is {{goal}}.", { level: k.goal.current, goal: k.goal.goal })
              : accessIssue
                ? tr("Keep your access to keep practising")
                : tr("Keep going")}
          </p>
          {situation(k).map((line) => (
            <p key={line} className="text-sm text-ink">
              {line}
            </p>
          ))}
          <p className="text-sm text-muted">
            {k.kind === "individual"
              ? accessIssue
                ? tr("Extend your access to keep practising and reach your goal.")
                : tr("Upgrade or extend your plan for more tests and time.")
              : timeHelps
                ? tr("Your organization manages your access. Ask your admin for more time.")
                : tr("Meanwhile, keep improving in Practice Modules: they have no monthly limit.")}
          </p>
        </div>

        {k.kind === "individual" ? (
          <Link to={`${ROUTES.PLANS}?months=${accessIssue ? 1 : 3}`} className="shrink-0">
            <Button>{accessIssue ? tr("Extend my access") : tr("See plans")}</Button>
          </Link>
        ) : pending || !timeHelps ? null : (
          !asking && (
            <Button onClick={() => setAsking(true)} className="shrink-0">
              <span className="flex items-center gap-1.5">
                <Send size={15} /> {tr("Ask my admin for more time")}
              </span>
            </Button>
          )
        )}
      </div>

      {k.kind === "org" && req && (
        <p
          className={`text-sm flex items-center gap-1.5 ${req.status === "approved" ? "text-success" : req.status === "rejected" ? "text-error" : "text-navy-deep"}`}
        >
          {req.status === "pending" ? <Clock size={15} /> : req.status === "approved" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {req.status === "pending"
            ? tr("Request for {{n}} more month(s) sent on {{date}}. Waiting for your admin.", { n: req.months, date: formatShortDate(req.createdAt) })
            : req.status === "approved"
              ? tr("Your admin approved {{n}} more month(s) on {{date}}.", { n: req.months, date: formatShortDate(req.decidedAt) })
              : tr("Your admin declined the request on {{date}}.", { date: formatShortDate(req.decidedAt) }) + (req.note ? ` ${req.note}` : "")}
        </p>
      )}

      {asking && (
        <div className="rounded-card border border-rule bg-surface p-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
            <CalendarClock size={15} /> {tr("How much more time do you need?")}
          </p>
          <div className="flex gap-2">
            {([1, 3] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`text-sm px-4 py-2 rounded-pill border cursor-pointer ${months === m ? "bg-navy text-white border-navy" : "border-rule text-ink hover:border-navy"}`}
              >
                {m === 1 ? tr("1 month") : tr("3 months")}
              </button>
            ))}
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={2}
            placeholder={tr("Optional: a note for your admin (e.g. my exam is on 8 Nov)")}
            className="w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink"
          />
          <p className="text-xs text-muted">{tr("Your admin also sees your level, your goal and the tests you've done.")}</p>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={send} disabled={sending}>
              {sending ? tr("Sending…") : tr("Send request")}
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)} disabled={sending}>
              {tr("Cancel")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
