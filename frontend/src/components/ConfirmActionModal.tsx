import { X } from "lucide-react";
import { Button } from "@/components/Button";

import { tr } from "@/i18n/tr";
// One generic "are you sure" modal for every destructive/state-changing
// action across the Org Admin console (delete/deactivate a batch, manager,
// or learner) instead of a near-identical bespoke modal per entity.
export function ConfirmActionModal({
  title,
  message,
  confirmLabel,
  destructive,
  submitting,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-5">
          <p className="text-sm text-ink">{message}</p>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              className={`flex-1 ${destructive ? "!bg-error hover:!bg-error/90" : ""}`}
            >
              {submitting ? tr("Working…") : confirmLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              {tr("Cancel")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
