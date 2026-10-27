import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/Button";
import { ROUTES } from "@/constants/routes";
import { formatShortDate, getKeepGoing, requestMoreTime, type KeepGoing } from "@/api/licenses";
import { tr } from "@/i18n/tr";

// Shown within this many days of the plan's end.
const NOTICE_DAYS = 10;

// Under the test plan on My journey: the plan ends soon, so the dates after it
// won't happen. An individual extends from Plans; a learner in an
// organization asks their admin in one click.
export function PlanEndingNotice() {
  const [k, setK] = useState<KeepGoing | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  useEffect(() => {
    getKeepGoing()
      .then(setK)
      .catch(() => setK(null));
  }, []);
  if (!k || k.kind === "other" || k.access.status !== "active" || k.access.daysLeft === null || k.access.daysLeft > NOTICE_DAYS || k.access.daysLeft < 0) return null;
  const days = k.access.daysLeft;
  const pending = k.request?.status === "pending" || state === "sent";

  async function ask() {
    setState("sending");
    try {
      await requestMoreTime(1, tr("My plan ends in {{n}} days.", { n: days }));
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-input border border-warning/40 bg-warning/10 px-4 py-3">
      <CalendarClock size={20} className="text-warning shrink-0" />
      <div className="flex-1 min-w-[220px]">
        <p className="text-sm font-semibold text-ink">
          {days <= 1
            ? tr("Your plan ends on {{date}}.", { date: formatShortDate(k.access.accessEndsAt) })
            : tr("Your plan ends on {{date}}, in {{n}} days.", { date: formatShortDate(k.access.accessEndsAt), n: days })}
        </p>
        <p className="text-sm text-ink">{tr("Would you like to extend your plan?")}</p>
        {state === "error" && <p className="text-xs text-error mt-1">{tr("The request couldn't be sent. Try again.")}</p>}
      </div>
      {k.kind === "individual" ? (
        <Link to={`${ROUTES.PLANS}?months=1`} className="shrink-0">
          <Button>{tr("Yes, extend my plan")}</Button>
        </Link>
      ) : pending ? (
        <span className="flex items-center gap-1.5 text-sm text-navy-deep shrink-0">
          {state === "sent" ? <CheckCircle2 size={15} /> : <Clock size={15} />}
          {tr("Request sent. Waiting for your admin.")}
        </span>
      ) : (
        <Button onClick={ask} disabled={state === "sending"} className="shrink-0">
          {tr("Yes, ask my admin")}
        </Button>
      )}
    </div>
  );
}
