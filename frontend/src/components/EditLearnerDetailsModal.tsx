import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { LearnerDetailsFields } from "@/components/LearnerDetailsFields";
import { detailsErrorMessage, type LearnerDetails } from "@/api/details";

import { tr } from "@/i18n/tr";
export function EditLearnerDetailsModal({
  name,
  initial,
  save,
  onClose,
  onSaved,
}: {
  name: string;
  initial: LearnerDetails;
  save: (d: LearnerDetails) => Promise<unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [details, setDetails] = useState<LearnerDetails>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await save(details);
      onSaved();
    } catch (err) {
      setError(detailsErrorMessage(err instanceof ApiError ? err.message : undefined) ?? tr("Couldn't save the details."));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <div>
            <h2 className="font-display font-bold text-lg text-ink">{tr("Employee details")}</h2>
            <p className="text-xs text-muted">{name}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <LearnerDetailsFields value={details} onChange={setDetails} />
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? tr("Saving…") : tr("Save details")}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {tr("Cancel")}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
