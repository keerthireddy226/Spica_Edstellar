import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { tr } from "@/i18n/tr";

// A Test ID (a fixed test set, e.g. "SL-001") or an Attempt ID (one sitting,
// e.g. "SL-7K3M-9QX2"), copyable: what a learner quotes to support or a
// reviewer searches for.
export function TestIdTag({ code, label, className = "" }: { code: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={tr("Copy")}
      className={`inline-flex items-center gap-1.5 rounded-pill border border-rule bg-paper-warm px-3 py-1 text-xs text-muted hover:text-ink cursor-pointer ${className}`}
    >
      {label ?? tr("Test ID")} <span className="font-mono font-semibold text-ink">{code}</span>
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
    </button>
  );
}
