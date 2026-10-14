import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/Button";
import { governanceApi } from "@/api/developers";

// A data subject request: removes everything that identifies the learner.
export function EraseLearnerModal({ learner, onClose, onErased }: { learner: { id: string; name: string }; onClose: () => void; onErased: () => void }) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Erase personal data</h2>
          <button onClick={onClose} className="text-muted hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-3">
          <p className="text-sm text-ink">
            This permanently removes <span className="font-semibold">{learner.name}</span>'s name, email, demographics, recordings, typed answers, face and voice
            data, and their certificates. Anonymous practice statistics and license records stay. <span className="font-semibold">This can't be undone.</span>
          </p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. data subject request #123" className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder='Type "ERASE" to confirm' className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex gap-3">
            <Button
              disabled={busy || reason.trim().length < 3 || typed !== "ERASE"}
              onClick={async () => {
                setBusy(true);
                try {
                  await governanceApi.eraseLearner(learner.id, reason.trim());
                  onErased();
                } catch {
                  setError("Couldn't erase. Please try again.");
                  setBusy(false);
                }
              }}
              className="flex-1 !bg-error !text-white"
            >
              {busy ? "Erasing…" : "Erase permanently"}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
