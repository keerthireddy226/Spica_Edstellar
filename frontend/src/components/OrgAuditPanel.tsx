import { useEffect, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { getOrgAudit, type OrgAuditEntry } from "@/api/admin";
import { downloadCsv } from "@/api/analytics";

import { tr } from "@/i18n/tr";
import { AUDIT_VERBS, auditDetailParts } from "@/lib/auditVerbs";
// A candidate with no name is shown by their invitation's placeholder address.
const isPlaceholder = (label: string | null | undefined) => !!label && label.endsWith("@candidate.spica.invalid");

// One entry as "who does what", and a short line of facts under it.
function describe(e: OrgAuditEntry): { line: ReactNode; facts: string } {
  const who = isPlaceholder(e.actorLabel) ? tr("A candidate") : (e.actorLabel ?? tr("System"));
  const d = (e.details ?? {}) as Record<string, unknown>;
  // A test's name without the form number: "English 4 Skills Essentials".
  const test = e.targetLabel?.split(" — ")[0] ?? null;
  let verb = AUDIT_VERBS[e.action] ?? e.action.replace(/[._]/g, " ");
  let target = test;
  let parts = auditDetailParts(d);
  if (e.action === "recruitment.candidates_invited" && typeof d.count === "number") {
    verb = d.count === 1 ? tr("invited 1 candidate") : tr("invited {{n}} candidates", { n: d.count });
    target = null;
    parts = parts.filter((p) => p !== tr("{{n}} people", { n: d.count }));
  }
  if (e.action === "test.started" || e.action === "test.completed") {
    // The level and score first; the attempt ID last, for looking it up.
    const attempt = typeof d.attemptId === "string" ? tr("Attempt ID {{c}}", { c: d.attemptId }) : null;
    parts = [...parts.filter((p) => p !== attempt && !p.startsWith(tr("Test ID {{c}}", { c: "" }).trim())), ...(attempt ? [attempt] : [])];
  }
  return {
    line: (
      <>
        <span className="font-semibold">{who}</span> {verb}
        {target && <span className="text-muted"> · {target}</span>}
      </>
    ),
    facts: parts.join(" · "),
  };
}

// The organization's audit trail, read-only, for Edstellar staff.
export function OrgAuditPanel({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<OrgAuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    getOrgAudit(tenantId)
      .then((r) => {
        setEntries(r.entries);
        setHasMore(r.hasMore);
      })
      .catch(() => {});
  }, [open, tenantId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setOpen((o) => !o)} className="text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink cursor-pointer">
          {tr("Audit log {{v}}", { v: open ? "▾" : "▸" })}
        </button>
        {open && (
          <button
            onClick={() => downloadCsv(`/admin/organizations/${tenantId}/audit?format=csv&limit=200`, "audit.csv")}
            className="flex items-center gap-1 text-xs font-semibold text-navy hover:underline cursor-pointer"
          >
            <Download size={12} /> {tr("CSV")}</button>
        )}
      </div>
      {open && (
        <div className="border border-rule rounded-input px-4 py-2 flex flex-col">
          {entries.length === 0 && <p className="text-sm text-muted py-1">{tr("Nothing recorded yet.")}</p>}
          {entries.map((e, i) => {
            const day = new Date(e.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" });
            const newDay = i === 0 || new Date(entries[i - 1].createdAt).toLocaleDateString(undefined, { dateStyle: "medium" }) !== day;
            const { line, facts } = describe(e);
            return (
              <div key={`${e.source}-${e.id}`}>
                {newDay && <p className="text-[11px] font-semibold uppercase tracking-wide text-muted pt-3 pb-1">{day}</p>}
                <div className="flex items-start justify-between gap-3 py-1.5 border-t border-rule/60 first:border-0">
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm text-ink">{line}</span>
                    {facts && <span className="text-xs text-muted">{facts}</span>}
                  </span>
                  <span className="text-xs text-muted shrink-0 tabular-nums">{new Date(e.createdAt).toLocaleTimeString(undefined, { timeStyle: "short" })}</span>
                </div>
              </div>
            );
          })}
          {hasMore && (
            <button
              onClick={() =>
                getOrgAudit(tenantId, entries[entries.length - 1]?.createdAt).then((r) => {
                  setEntries((p) => [...p, ...r.entries]);
                  setHasMore(r.hasMore);
                })
              }
              className="self-center text-xs font-semibold text-navy hover:underline cursor-pointer mt-1"
            >
              {tr("Load more")}</button>
          )}
        </div>
      )}
    </div>
  );
}
