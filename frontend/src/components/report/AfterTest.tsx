import { useEffect, useState } from "react";
import { MessageSquareText, Star } from "lucide-react";
import { Button } from "@/components/Button";
import { fileAppeal, getFeedbackDue, getMyAppeals, sendFeedback, type MyAppeal } from "@/api/quality";
import { tr } from "@/i18n/tr";
import { useAuth } from "@/hooks/useAuth";

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

// "Request a review": a reason, sent to the Spica review team; then its status.
// kind: "concern" for practice and mock tests, "review" for placement and real tests.
export function ReviewRequest({ sessionId, kind }: { sessionId: string; kind: "review" | "concern" }) {
  // A job or admissions candidate asks their recruiter, who requests it for them.
  const candidate = useAuth().user?.role === "candidate";
  const [mine, setMine] = useState<MyAppeal | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    getMyAppeals()
      .then((r) => setMine(r.appeals.find((a) => a.sessionId === sessionId) ?? null))
      .catch(() => setMine(null));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await fileAppeal(sessionId, reason.trim());
      setOpen(false);
      await load();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(code === "too_late" ? tr("The time to ask for a review of this test has passed.") : code === "already_appealed" ? tr("You have already asked for a review of this test.") : tr("Could not send your request. Try again."));
    } finally {
      setBusy(false);
    }
  }
  if (mine === undefined || candidate) return null;
  return (
    <div className="w-full bg-surface border border-rule rounded-card p-5 flex flex-col gap-3 text-left">
      <p className="font-display font-bold text-base text-ink">{kind === "review" ? tr("Think your score is wrong?") : tr("Does this score not reflect your level?")}</p>
      {mine ? (
        <>
          <p className="text-sm text-ink">{STATUS[mine.status]()}</p>
          {mine.note && <p className="text-sm text-muted bg-paper-warm rounded-input px-3 py-2">{mine.note}</p>}
        </>
      ) : open ? (
        <>
          <p className="text-sm text-muted">
            {kind === "review"
              ? tr("A reviewer from the Spica review team will check your answers and recordings, and can change your score.")
              : tr("A reviewer from the Spica review team will look at your answers. Practice and mock scores aren't changed, but your concern helps us improve scoring.")}
          </p>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            placeholder={tr("Tell us what you think is wrong (at least 10 characters)")}
            className="rounded-input border border-rule bg-surface px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={send} disabled={busy || reason.trim().length < 10}>
              {tr("Send request")}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              {tr("Cancel")}
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {tr("Request a review")}
          </Button>
        </div>
      )}
    </div>
  );
}
