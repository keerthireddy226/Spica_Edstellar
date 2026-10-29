import { useEffect, useState } from "react";
import { MessageSquareText, Star } from "lucide-react";
import { Button } from "@/components/Button";
import { fileAppeal, getFeedbackDue, sendFeedback, type MyAppeal } from "@/api/quality";
import { tr } from "@/i18n/tr";

// Shown under a learner's result: the short feedback form (once per test) and
// the request for a person to review the score. Requests go to the Spica
// review team (Edstellar), whoever onboarded the learner.

const ISSUES: [string, () => string][] = [
  ["audio", () => tr("Audio didn't play")],
  ["camera_mic", () => tr("Camera or microphone")],
  ["slow", () => tr("Slow or freezing")],
  ["screen", () => tr("Screen sharing")],
  ["other", () => tr("Something else")],
];

export function TestFeedbackCard({ sessionId }: { sessionId: string }) {
  const [due, setDue] = useState(false);
  const [done, setDone] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [smooth, setSmooth] = useState<boolean | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [recommend, setRecommend] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getFeedbackDue(sessionId)
      .then((r) => setDue(r.due))
      .catch(() => setDue(false));
  }, [sessionId]);
  if (done) return <p className="text-sm text-success text-center">{tr("Thank you for your feedback.")}</p>;
  if (!due) return null;
  async function send(skipped: boolean) {
    setBusy(true);
    await sendFeedback(sessionId, skipped ? { skipped: true } : { rating, smooth, issues, recommend, suggestion }).catch(() => {});
    setBusy(false);
    if (skipped) setDue(false);
    else setDone(true);
  }
  const pill = (on: boolean) => `px-3 py-1.5 rounded-pill border text-sm cursor-pointer ${on ? "border-navy bg-navy/10 text-navy-deep font-semibold" : "border-rule text-ink"}`;
  return (
    <div className="w-full bg-surface border border-rule rounded-card p-5 flex flex-col gap-4 text-left">
      <p className="flex items-center gap-2 font-display font-bold text-base text-ink">
        <MessageSquareText size={18} className="text-navy-deep" /> {tr("How was your test?")}
      </p>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-ink">{tr("Your experience")}</p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={String(n)} onClick={() => setRating(n)} className="cursor-pointer">
              <Star size={26} className={rating != null && n <= rating ? "fill-warning text-warning" : "text-muted"} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-ink">{tr("Did the test run smoothly?")}</p>
        <div className="flex gap-2">
          <button type="button" className={pill(smooth === true)} onClick={() => setSmooth(true)}>
            {tr("Yes")}
          </button>
          <button type="button" className={pill(smooth === false)} onClick={() => setSmooth(false)}>
            {tr("No")}
          </button>
        </div>
        {smooth === false && (
          <div className="flex flex-wrap gap-2 mt-1">
            {ISSUES.map(([k, label]) => (
              <button key={k} type="button" className={pill(issues.includes(k))} onClick={() => setIssues(issues.includes(k) ? issues.filter((x) => x !== k) : [...issues, k])}>
                {label()}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-ink">{tr("How likely are you to recommend Spica to a friend or colleague?")}</p>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 11 }, (_, n) => (
            <button key={n} type="button" onClick={() => setRecommend(n)} className={`h-8 w-8 rounded-md border text-sm cursor-pointer ${recommend === n ? "border-navy bg-navy text-white" : "border-rule text-ink"}`}>
              {n}
            </button>
          ))}
        </div>
        <p className="flex justify-between text-[11px] text-muted max-w-[22rem]">
          <span>{tr("Not likely")}</span>
          <span>{tr("Very likely")}</span>
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm text-ink">
        {tr("Any suggestions? (optional)")}
        <textarea rows={2} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} maxLength={2000} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => send(false)} disabled={busy || (rating == null && smooth == null && recommend == null && !suggestion.trim())}>
          {tr("Send feedback")}
        </Button>
        <Button variant="secondary" onClick={() => send(true)} disabled={busy}>
          {tr("Skip")}
        </Button>
      </div>
    </div>
  );
}

const STATUS: Record<MyAppeal["status"], () => string> = {
  pending: () => tr("Sent to the Spica review team. You'll hear back within 5 working days."),
  in_review: () => tr("A reviewer from the Spica review team is looking at your test."),
  upheld: () => tr("Reviewed: the score stands."),
  changed: () => tr("Reviewed: your result was re-marked."),
  new_attempt: () => tr("Reviewed: you can take the test again."),
  noted: () => tr("Reviewed: thank you, your concern was noted."),
};

// "Request a review" on a test's row in My reports: a small link that opens a
// reason box under the row, or the request's status once sent.
export function ReviewRequestRow({ sessionId, kind, mine, onSent }: { sessionId: string; kind: "review" | "concern"; mine: MyAppeal | null; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await fileAppeal(sessionId, reason.trim());
      setOpen(false);
      onSent();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(code === "too_late" ? tr("The time to ask for a review of this test has passed.") : code === "already_appealed" ? tr("You have already asked for a review of this test.") : tr("Could not send your request. Try again."));
    } finally {
      setBusy(false);
    }
  }
  if (mine) return <p className="basis-full px-4 pb-3 text-xs text-muted">{STATUS[mine.status]()}{mine.note ? ` ${mine.note}` : ""}</p>;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="shrink-0 mr-4 text-xs font-semibold text-navy-deep border border-rule rounded-pill px-2.5 py-1 hover:bg-paper-warm cursor-pointer">
        {tr("Request a review")}
      </button>
    );
  return (
    <div className="basis-full px-4 pb-3 flex flex-col gap-2">
      <p className="text-xs text-muted">
        {kind === "review"
          ? tr("A reviewer from the Spica review team will check your answers and recordings, and can change your score.")
          : tr("A reviewer from the Spica review team will look at your answers. Practice and mock scores aren't changed, but your concern helps us improve scoring.")}
      </p>
      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder={tr("Tell us what you think is wrong (at least 10 characters)")} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={send} disabled={busy || reason.trim().length < 10} className="!py-1.5 !text-sm">
          {tr("Send request")}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} className="!py-1.5 !text-sm">
          {tr("Cancel")}
        </Button>
      </div>
    </div>
  );
}
