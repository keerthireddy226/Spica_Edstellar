import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { getOrgAudit, type OrgAuditEntry } from "@/api/admin";
import { downloadCsv } from "@/api/analytics";

import { tr } from "@/i18n/tr";
import { AUDIT_VERBS, auditDetailParts } from "@/lib/auditVerbs";
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
        <div className="border border-rule rounded-input px-4 py-3 flex flex-col gap-1.5">
          {entries.length === 0 && <p className="text-sm text-muted">{tr("Nothing recorded yet.")}</p>}
          {entries.map((e) => (
            <div key={`${e.source}-${e.id}`} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-ink">
                <span className="font-medium">{e.actorLabel ?? tr("System")}</span> · {AUDIT_VERBS[e.action] ?? e.action.replace(/[._]/g, " ")}
                {e.targetLabel && <span className="text-muted"> — {e.targetLabel}</span>}
                {e.details && auditDetailParts(e.details as Record<string, unknown>).length > 0 && (
                  <span className="text-muted"> ({auditDetailParts(e.details as Record<string, unknown>).join(" · ")})</span>
                )}
              </span>
              <span className="text-xs text-muted shrink-0">{new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
          ))}
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
