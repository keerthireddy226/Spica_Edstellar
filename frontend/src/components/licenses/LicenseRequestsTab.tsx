import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import {
  REQUEST_STATUS_CLASS,
  decideLicenseRequest,
  describeLicenseRequest,
  formatShortDate,
  type LicenseRequest,
} from "@/api/licenses";

const ERRORS: Record<string, string> = {
  not_pending: "This request was already handled.",
  nothing_to_unassign: "That learner has no unused months left to return.",
};

function RequestRow({ r, onDecided }: { r: LicenseRequest; onDecided: () => void }) {
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!deciding) return;
    setBusy(true);
    setError(null);
    try {
      await decideLicenseRequest(r.id, deciding === "approve", note.trim() || undefined);
      onDecided();
    } catch (err) {
      setError(ERRORS[err instanceof ApiError ? err.message : ""] ?? "Couldn't save the decision.");
      setBusy(false);
    }
  }

  const after =
    r.kind === "increase_allotment"
      ? (r.batchAllotment ?? 0) + r.quantity
      : r.kind === "decrease_allotment"
        ? Math.max(r.batchUsed, (r.batchAllotment ?? 0) - r.quantity)
        : null;

  return (
    <div className="border border-rule rounded-input p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{describeLicenseRequest(r)}</p>
          <p className="text-xs text-muted">
            {r.requestedBy ?? "A Manager"} · {formatShortDate(r.createdAt)}
            {r.batchName && r.kind !== "unassign_learner" ? ` · ${r.batchName} allotment ${r.batchAllotment ?? 0}, ${r.batchUsed} assigned` : ""}
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill capitalize ${REQUEST_STATUS_CLASS[r.status]}`}>{r.status}</span>
      </div>
      <p className="text-sm text-ink bg-paper-warm rounded-input px-3 py-2">“{r.reason}”</p>
      {r.status !== "pending" && (r.decisionNote || r.decidedBy) && (
        <p className="text-xs text-muted">
          {r.decidedBy ? `${r.decidedBy}: ` : ""}
          {r.decisionNote ?? (r.status === "approved" ? "Applied." : "")}
        </p>
      )}
      {r.status === "pending" && !deciding && (
        <div className="flex items-center gap-2">
          <Button onClick={() => setDeciding("approve")} className="!px-3 !py-1.5 !text-xs flex items-center gap-1.5">
            <Check size={14} /> Approve
          </Button>
          <Button variant="secondary" onClick={() => setDeciding("reject")} className="!px-3 !py-1.5 !text-xs flex items-center gap-1.5">
            <X size={14} /> Decline
          </Button>
          {after !== null && <span className="text-xs text-muted">Approving sets {r.batchName}'s allotment to {after}.</span>}
        </div>
      )}
      {deciding && (
        <div className="flex flex-col gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={deciding === "approve" ? "Note to the Manager (optional)" : "Why are you declining? (optional)"}
            className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={busy} className={`!px-3 !py-1.5 !text-xs ${deciding === "reject" ? "!bg-error hover:!bg-error/90" : ""}`}>
              {busy ? "Saving…" : deciding === "approve" ? "Confirm approval" : "Confirm decline"}
            </Button>
            <Button variant="secondary" onClick={() => setDeciding(null)} disabled={busy} className="!px-3 !py-1.5 !text-xs">
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function LicenseRequestsTab({ requests, onChanged }: { requests: LicenseRequest[]; onChanged: () => void }) {
  if (requests.length === 0) {
    return <p className="text-sm text-muted">No requests yet. Managers can ask for more or fewer licenses, or to return a learner's unused months.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {requests.map((r) => (
        <RequestRow key={r.id} r={r} onDecided={onChanged} />
      ))}
    </div>
  );
}
