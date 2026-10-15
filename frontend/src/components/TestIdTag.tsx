import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { tr } from "@/i18n/tr";

// A test attempt's ID, copyable: what a learner quotes to support or a
// reviewer searches for.
export function TestIdTag({ code, className = "" }: { code: string; className?: string }) {
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
      title={tr("Copy the Test ID")}
      className={`inline-flex items-center gap-1.5 rounded-pill border border-rule bg-paper-warm px-3 py-1 text-xs text-muted hover:text-ink cursor-pointer ${className}`}
    >
      {tr("Test ID")} <span className="font-mono font-semibold text-ink">{code}</span>
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
    </button>
  );
}
