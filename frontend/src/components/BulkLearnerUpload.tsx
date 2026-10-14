import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/Button";
import { downloadText, parseCsv, toCsv } from "@/lib/csv";

export interface BulkRow {
  email: string;
  firstName: string;
  lastName: string;
}

export interface BulkResult {
  email: string;
  status: "created" | "duplicate" | "invalid";
  message?: string;
  licenseError?: string | null;
}

type RowState = BulkRow & { line: number; problem: string | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER_ALIASES: Record<keyof BulkRow, string[]> = {
  email: ["email", "e-mail", "email address", "mail"],
  firstName: ["firstname", "first name", "first", "given name", "givenname"],
  lastName: ["lastname", "last name", "last", "surname", "family name", "familyname"],
};

// Finds the columns by header name when there is a header row, otherwise
// assumes email, first name, last name.
function toRows(table: string[][]): BulkRow[] {
  if (table.length === 0) return [];
  const head = table[0].map((h) => h.toLowerCase().replace(/[_]/g, " ").trim());
  const idx = (k: keyof BulkRow) => head.findIndex((h) => HEADER_ALIASES[k].includes(h));
  const hasHeader = idx("email") !== -1;
  const cols = hasHeader ? { email: idx("email"), firstName: idx("firstName"), lastName: idx("lastName") } : { email: 0, firstName: 1, lastName: 2 };
  return table.slice(hasHeader ? 1 : 0).map((r) => ({
    email: (r[cols.email] ?? "").trim(),
    firstName: cols.firstName >= 0 ? (r[cols.firstName] ?? "").trim() : "",
    lastName: cols.lastName >= 0 ? (r[cols.lastName] ?? "").trim() : "",
  }));
}

function check(rows: BulkRow[], existing: Set<string>): RowState[] {
  const seen = new Map<string, number>();
  return rows.map((r, i) => {
    const key = r.email.toLowerCase();
    let problem: string | null = null;
    if (!EMAIL_RE.test(r.email)) problem = "Invalid email";
    else if (!r.firstName || !r.lastName) problem = "First and last name needed";
    else if (seen.has(key)) problem = `Duplicate of row ${seen.get(key)}`;
    else if (existing.has(key)) problem = "Already has an account";
    if (!seen.has(key)) seen.set(key, i + 1);
    return { ...r, line: i + 1, problem };
  });
}

// Shared by the Org Admin and Manager invite flows: template, preview with
// problems flagged per row, invite only the good ones, downloadable report.
export function BulkLearnerUpload({
  maxRows,
  checkExisting,
  submit,
  extraNote,
  onReadyChange,
  onDone,
}: {
  maxRows: number;
  checkExisting: (emails: string[]) => Promise<string[]>;
  submit: (rows: BulkRow[]) => Promise<BulkResult[]>;
  extraNote?: string | null;
  // How many rows would be invited right now, for license math in the parent.
  onReadyChange?: (ready: number) => void;
  onDone: (created: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setResults(null);
    setError(null);
    const parsed = toRows(parseCsv(await file.text())).filter((r) => r.email || r.firstName || r.lastName);
    if (parsed.length === 0) {
      setRows([]);
      setError("Couldn't find any rows. Use the template: email, first name, last name.");
      return;
    }
    if (parsed.length > maxRows) {
      setError(`That file has ${parsed.length} rows; the limit is ${maxRows} per upload. Only the first ${maxRows} are shown.`);
    }
    const limited = parsed.slice(0, maxRows);
    setBusy(true);
    try {
      const existing = new Set((await checkExisting(limited.map((r) => r.email).filter((x) => EMAIL_RE.test(x)))).map((x) => x.toLowerCase()));
      setRows(check(limited, existing));
    } catch {
      setRows(check(limited, new Set()));
    } finally {
      setBusy(false);
    }
  }

  function remove(line: number) {
    setRows((prev) => {
      const kept = prev.filter((r) => r.line !== line);
      // Re-check so a "duplicate of row N" clears when row N is removed.
      const existing = new Set(prev.filter((r) => r.problem === "Already has an account").map((r) => r.email.toLowerCase()));
      return check(kept, existing).map((r, i) => ({ ...r, line: kept[i].line }));
    });
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      setResults(await submit(rows.filter((r) => !r.problem).map(({ email, firstName, lastName }) => ({ email, firstName, lastName }))));
    } catch {
      setError("Something went wrong sending the invites.");
    } finally {
      setBusy(false);
    }
  }

  function downloadReport() {
    const skipped = rows.filter((r) => r.problem).map((r) => [r.email, r.firstName, r.lastName, "Skipped", r.problem]);
    const sent = (results ?? []).map((r) => {
      const row = rows.find((x) => x.email.toLowerCase() === r.email.toLowerCase());
      const status = r.status === "created" ? (r.licenseError ? "Invited, no license" : "Invited") : r.status === "duplicate" ? "Already exists" : "Failed";
      return [r.email, row?.firstName ?? "", row?.lastName ?? "", status, r.message ?? r.licenseError ?? ""];
    });
    downloadText(toCsv([["email", "first name", "last name", "result", "details"], ...sent, ...skipped]), "invite-report.csv");
  }

  const ready = rows.filter((r) => !r.problem).length;
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);
  const created = results?.filter((r) => r.status === "created").length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted">Up to {maxRows} learners per file. Columns: email, first name, last name.</p>
        <button
          type="button"
          onClick={() => downloadText(toCsv([["email", "first name", "last name"], ["ana.silva@example.com", "Ana", "Silva"]]), "learners-template.csv")}
          className="flex items-center gap-1.5 text-xs font-semibold text-navy hover:underline cursor-pointer"
        >
          <Download size={13} /> Template
        </button>
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex items-center justify-center gap-2 border-2 border-dashed border-rule rounded-card px-4 py-6 text-sm text-muted hover:border-navy hover:text-navy transition-colors cursor-pointer"
      >
        <Upload size={18} />
        {fileName ? `Selected: ${fileName} · choose another` : "Choose a CSV file"}
      </button>
      <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" onChange={handleFile} className="hidden" />
      {error && <p className="text-sm text-error">{error}</p>}

      {rows.length > 0 && !results && (
        <>
          <p className="text-sm text-ink">
            <span className="font-semibold">{ready}</span> ready
            {rows.length - ready > 0 && (
              <>
                {" · "}
                <span className="text-error font-semibold">{rows.length - ready}</span> will be skipped
              </>
            )}
            {extraNote ? ` · ${extraNote}` : ""}
          </p>
          <div className="max-h-64 overflow-y-auto border border-rule rounded-card">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-muted border-b border-rule">
                  <th className="px-3 py-2 w-10">#</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Check</th>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className={`border-b border-rule last:border-0 ${r.problem ? "bg-error/5" : ""}`}>
                    <td className="px-3 py-1.5 text-muted">{r.line}</td>
                    <td className="px-3 py-1.5 text-ink break-all">{r.email || "—"}</td>
                    <td className="px-3 py-1.5 text-ink">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td className={`px-3 py-1.5 ${r.problem ? "text-error" : "text-success"}`}>{r.problem ?? "Ready"}</td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => remove(r.line)} title="Remove row" className="text-muted hover:text-error cursor-pointer">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={send} disabled={busy || ready === 0} className="self-start flex items-center gap-2">
            <FileText size={16} /> {busy ? "Sending…" : `Send ${ready} invite${ready === 1 ? "" : "s"}`}
          </Button>
        </>
      )}

      {results && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-success">
            {created} invited
            {results.length - created > 0 ? ` · ${results.length - created} not invited` : ""}
            {rows.some((r) => r.problem) ? ` · ${rows.filter((r) => r.problem).length} skipped` : ""}
            {results.some((r) => r.licenseError) ? ` · ${results.filter((r) => r.licenseError).length} without a license (pool ran out)` : ""}.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={downloadReport} className="flex items-center gap-2">
              <Download size={15} /> Download report
            </Button>
            <Button onClick={() => onDone(created)}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}
