import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/Button";
import { downloadText, parseCsv, toCsv } from "@/lib/csv";
import type { LearnerDetails } from "@/api/details";
import type { AgeBand, Gender, JobRole } from "@/api/onboarding";
import { AGE_BANDS, COUNTRY_CODES, JOB_ROLES, countryName } from "@/constants/demographics";

import { tr } from "@/i18n/tr";
export interface BulkRow extends Partial<LearnerDetails> {
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
type Column = "email" | "firstName" | "lastName" | keyof LearnerDetails;
const HEADER_ALIASES: Record<Column, string[]> = {
  email: ["email", "e-mail", "email address", "mail"],
  firstName: ["firstname", "first name", "first", "given name", "givenname"],
  lastName: ["lastname", "last name", "last", "surname", "family name", "familyname"],
  employeeId: ["employee id", "employeeid", "emp id", "empid", "employee number", "employee no", "staff id"],
  department: ["department", "dept", "team"],
  jobTitle: ["job title", "jobtitle", "title", "designation", "position"],
  phone: ["phone", "phone number", "mobile", "work phone", "contact number"],
  country: ["country", "country code"],
  city: ["city", "town"],
  jobRole: ["job role", "jobrole", "role", "function"],
  gender: ["gender", "sex"],
  ageBand: ["age", "age band", "ageband", "age group", "age range"],
};
const DETAIL_COLUMNS: (keyof LearnerDetails)[] = ["employeeId", "department", "jobTitle", "phone", "country", "city", "jobRole", "gender", "ageBand"];
const TEMPLATE_HEADER = ["email", "first name", "last name", "employee id", "department", "job title", "phone", "country", "city", "job role", "gender", "age"];

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9+]/g, "");

// CSV cells are free text; these turn them into the values the API takes,
// or say what's wrong.
function toGender(v: string): Gender | null | Error {
  const k = squash(v);
  if (!k) return null;
  if (["f", "female", "woman"].includes(k)) return "female";
  if (["m", "male", "man"].includes(k)) return "male";
  if (["nonbinary", "nb", "other"].includes(k)) return "non_binary";
  if (k.startsWith("prefernot") || k === "undisclosed") return "prefer_not";
  return new Error(`Unknown gender "${v}"`);
}

function toAgeBand(v: string): AgeBand | null | Error {
  const k = squash(v);
  if (!k) return null;
  if (/^\d{1,3}$/.test(k)) {
    const n = Number(k);
    return n < 18 ? "under_18" : n <= 24 ? "18_24" : n <= 34 ? "25_34" : n <= 44 ? "35_44" : n <= 54 ? "45_54" : "55_plus";
  }
  if (k === "under18" || k === "18") return "under_18";
  if (k === "55+" || k === "55plus" || k === "55andabove") return "55_plus";
  const band = AGE_BANDS.find((a) => squash(a) === k);
  return band ?? new Error(`Unknown age "${v}"`);
}

function toCountry(v: string): string | null | Error {
  const k = v.trim();
  if (!k) return null;
  if (/^[a-z]{2}$/i.test(k)) return k.toUpperCase();
  const hit = COUNTRY_CODES.find((c) => squash(countryName(c, "en")) === squash(k));
  return hit ?? new Error(`Unknown country "${v}" — use a 2-letter code like IN`);
}

const ROLE_SYNONYMS: Record<string, JobRole> = { it: "it_engineering", engineering: "it_engineering", support: "customer_support", sales: "sales_marketing", marketing: "sales_marketing" };
function toJobRole(v: string): JobRole | null | Error {
  const k = squash(v);
  if (!k) return null;
  return JOB_ROLES.find((r) => squash(r) === k) ?? ROLE_SYNONYMS[k] ?? new Error(`Unknown job role "${v}"`);
}

// Finds the columns by header name when there is a header row, otherwise
// assumes email, first name, last name, then the detail columns in template order.
function toRows(table: string[][]): (BulkRow & { problem?: string })[] {
  if (table.length === 0) return [];
  const head = table[0].map((h) => h.toLowerCase().replace(/[_]/g, " ").trim());
  const idx = (k: Column) => head.findIndex((h) => HEADER_ALIASES[k].includes(h));
  const hasHeader = idx("email") !== -1;
  const all: Column[] = ["email", "firstName", "lastName", ...DETAIL_COLUMNS];
  const cols = Object.fromEntries(all.map((k, i) => [k, hasHeader ? idx(k) : i])) as Record<Column, number>;
  return table.slice(hasHeader ? 1 : 0).map((r) => {
    const cell = (k: Column) => (cols[k] >= 0 ? (r[cols[k]] ?? "").trim() : "");
    const row: BulkRow & { problem?: string } = { email: cell("email"), firstName: cell("firstName"), lastName: cell("lastName") };
    for (const k of ["employeeId", "department", "jobTitle", "phone", "city"] as const) if (cell(k)) row[k] = cell(k);
    const parsed: [keyof LearnerDetails, string | null | Error][] = [
      ["country", toCountry(cell("country"))],
      ["jobRole", toJobRole(cell("jobRole"))],
      ["gender", toGender(cell("gender"))],
      ["ageBand", toAgeBand(cell("ageBand"))],
    ];
    for (const [k, v] of parsed) {
      if (v instanceof Error) row.problem ??= v.message;
      else if (v) (row as unknown as Record<string, unknown>)[k] = v;
    }
    return row;
  });
}

function check(rows: (BulkRow & { problem?: string | null })[], existing: Set<string>): RowState[] {
  const seen = new Map<string, number>();
  const seenEmployee = new Map<string, number>();
  return rows.map((r, i) => {
    const key = r.email.toLowerCase();
    const emp = r.employeeId?.toLowerCase();
    let problem: string | null = null;
    if (!EMAIL_RE.test(r.email)) problem = tr("Invalid email");
    else if (!r.firstName || !r.lastName) problem = tr("First and last name needed");
    else if (seen.has(key)) problem = tr("Duplicate of row {{get}}", { get: seen.get(key) });
    else if (existing.has(key)) problem = tr("Already has an account");
    else if (emp && seenEmployee.has(emp)) problem = tr("Same employee ID as row {{get}}", { get: seenEmployee.get(emp) });
    else if (r.problem) problem = r.problem;
    if (!seen.has(key)) seen.set(key, i + 1);
    if (emp && !seenEmployee.has(emp)) seenEmployee.set(emp, i + 1);
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
      setError(tr("Couldn't find any rows. Use the template: email, first name, last name."));
      return;
    }
    if (parsed.length > maxRows) {
      setError(tr("That file has {{length}} rows; the limit is {{maxRows}} per upload. Only the first {{maxRows2}} are shown.", { length: parsed.length, maxRows: maxRows, maxRows2: maxRows }));
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
      const existing = new Set(prev.filter((r) => r.problem === tr("Already has an account")).map((r) => r.email.toLowerCase()));
      // Problems from reading the file (unknown gender, etc.) stay.
      const parseProblem = (r: RowState) => (r.problem && /^Unknown /.test(r.problem) ? r.problem : null);
      return check(kept.map((r) => ({ ...r, problem: parseProblem(r) })), existing).map((r, i) => ({ ...r, line: kept[i].line }));
    });
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      setResults(await submit(rows.filter((r) => !r.problem).map(({ line: _line, problem: _problem, ...row }) => row)));
    } catch {
      setError(tr("Something went wrong sending the invites."));
    } finally {
      setBusy(false);
    }
  }

  function downloadReport() {
    const skipped = rows.filter((r) => r.problem).map((r) => [r.email, r.firstName, r.lastName, tr("Skipped"), r.problem]);
    const sent = (results ?? []).map((r) => {
      const row = rows.find((x) => x.email.toLowerCase() === r.email.toLowerCase());
      const status = r.status === "created" ? (r.licenseError ? tr("Invited, no license") : tr("Invited")) : r.status === "duplicate" ? tr("Already exists") : tr("Failed");
      return [r.email, row?.firstName ?? "", row?.lastName ?? "", status, r.message ?? r.licenseError ?? ""];
    });
    downloadText(toCsv([["email", tr("first name"), tr("last name"), "result", "details"], ...sent, ...skipped]), "invite-report.csv");
  }

  const ready = rows.filter((r) => !r.problem).length;
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);
  const created = results?.filter((r) => r.status === "created").length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted">
          {tr("Up to {{maxRows}} learners per file. Columns: email, first name, last name; optionally employee ID, department, job title, phone, country, city, job role, gender, age.", { maxRows: maxRows })}</p>
        <button
          type="button"
          onClick={() =>
            downloadText(
              toCsv([
                TEMPLATE_HEADER,
                ["ana.silva@example.com", tr("Ana"), tr("Silva"), tr("EMP-1042"), tr("Customer Support"), tr("Support Associate"), "+91 98765 43210", "IN", tr("Hyderabad"), "customer_support", "female", "25-34"],
              ]),
              "learners-template.csv",
            )
          }
          className="flex items-center gap-1.5 text-xs font-semibold text-navy hover:underline cursor-pointer"
        >
          <Download size={13} /> {tr("Template")}</button>
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex items-center justify-center gap-2 border-2 border-dashed border-rule rounded-card px-4 py-6 text-sm text-muted hover:border-navy hover:text-navy transition-colors cursor-pointer"
      >
        <Upload size={18} />
        {fileName ? tr("Selected: {{fileName}} · choose another", { fileName: fileName }) : tr("Choose a CSV file")}
      </button>
      <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" onChange={handleFile} className="hidden" />
      {error && <p className="text-sm text-error">{error}</p>}

      {rows.length > 0 && !results && (
        <>
          <p className="text-sm text-ink">
            <span className="font-semibold">{ready}</span> {tr("ready")}{rows.length - ready > 0 && (
              <>
                {" · "}
                <span className="text-error font-semibold">{rows.length - ready}</span> {tr("will be skipped")}</>
            )}
            {extraNote ? ` · ${extraNote}` : ""}
          </p>
          <div className="max-h-64 overflow-y-auto border border-rule rounded-card">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-muted border-b border-rule">
                  <th className="px-3 py-2 w-10">#</th>
                  <th className="px-3 py-2">{tr("Email")}</th>
                  <th className="px-3 py-2">{tr("Name")}</th>
                  <th className="px-3 py-2">{tr("Employee")}</th>
                  <th className="px-3 py-2">{tr("Check")}</th>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className={`border-b border-rule last:border-0 ${r.problem ? "bg-error/5" : ""}`}>
                    <td className="px-3 py-1.5 text-muted">{r.line}</td>
                    <td className="px-3 py-1.5 text-ink break-all">{r.email || "—"}</td>
                    <td className="px-3 py-1.5 text-ink">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-3 py-1.5 text-muted">{[r.employeeId, r.department].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={`px-3 py-1.5 ${r.problem ? "text-error" : "text-success"}`}>{r.problem ?? tr("Ready")}</td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => remove(r.line)} title={tr("Remove row")} className="text-muted hover:text-error cursor-pointer">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={send} disabled={busy || ready === 0} className="self-start flex items-center gap-2">
            <FileText size={16} /> {busy ? tr("Sending…") : ready === 1 ? tr("Send 1 invite") : tr("Send {{n}} invites", { n: ready })}
          </Button>
        </>
      )}

      {results && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-success">
            {tr("{{created}} invited", { created: created })}{results.length - created > 0 ? tr(" · {{v}} not invited", { v: results.length - created }) : ""}
            {rows.some((r) => r.problem) ? tr(" · {{length}} skipped", { length: rows.filter((r) => r.problem).length }) : ""}
            {results.some((r) => r.licenseError) ? tr(" · {{length}} without a license (not enough licenses)", { length: results.filter((r) => r.licenseError).length }) : ""}.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={downloadReport} className="flex items-center gap-2">
              <Download size={15} /> {tr("Download report")}</Button>
            <Button onClick={() => onDone(created)}>{tr("Done")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
