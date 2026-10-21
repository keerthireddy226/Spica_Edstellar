import { tr } from "@/i18n/tr";

// A learner's latest final assessment certificate, as lists and reports show it.
export interface CertifiedSummary {
  code: string;
  level: string | null;
  score: number | null;
  testName: string | null;
  issuedAt: string;
  validUntil: string | null;
}

export function CertifiedCell({ c }: { c: CertifiedSummary | null | undefined }) {
  if (!c) return <span className="text-muted">—</span>;
  return (
    <a
      href={`/certificate/${c.code}`}
      target="_blank"
      rel="noopener"
      onClick={(e) => e.stopPropagation()}
      title={c.testName ?? undefined}
      className="font-semibold text-success hover:underline whitespace-nowrap"
    >
      {c.level ?? tr("Certified")}
      {c.score !== null ? <span className="font-normal text-muted"> · {c.score}</span> : null}
    </a>
  );
}
