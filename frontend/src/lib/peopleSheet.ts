// Candidates from a spreadsheet (CSV or Excel): the columns are found by
// their headings (Email, First name, Last name, or a single Name), or, with no
// heading row, taken in the order email, first name, last name. Rows without
// a usable email are reported, not invited.

export interface SheetPerson {
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface SheetResult {
  people: SheetPerson[];
  // Spreadsheet row numbers (1-based) that had no valid email.
  badRows: number[];
  // The same email twice in the file: kept once.
  duplicates: number;
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function peopleFromRows(rows: string[][]): SheetResult {
  if (!rows.length) return { people: [], badRows: [], duplicates: 0 };
  const head = rows[0].map(norm);
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
  let emailCol = find("email", "emailaddress", "emailid", "mail", "eaddress");
  const hasHeader = emailCol >= 0 || head.some((h) => ["firstname", "lastname", "name", "fullname"].includes(h));
  if (!hasHeader) emailCol = 0;
  const firstCol = hasHeader ? find("firstname", "givenname", "first") : 1;
  const lastCol = hasHeader ? find("lastname", "surname", "familyname", "last") : 2;
  const nameCol = hasHeader ? find("name", "fullname", "candidatename", "candidate") : -1;
  const body = hasHeader ? rows.slice(1) : rows;
  const offset = hasHeader ? 2 : 1;
  const out: SheetPerson[] = [];
  const badRows: number[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  body.forEach((r, i) => {
    const email = (emailCol >= 0 ? r[emailCol] : r.find((c) => EMAIL.test(c.trim())) ?? "")?.trim() ?? "";
    if (!EMAIL.test(email)) {
      badRows.push(i + offset);
      return;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);
    let firstName = firstCol >= 0 ? r[firstCol]?.trim() : "";
    let lastName = lastCol >= 0 ? r[lastCol]?.trim() : "";
    if (!firstName && !lastName && nameCol >= 0 && r[nameCol]) {
      const parts = r[nameCol].trim().split(/\s+/);
      firstName = parts[0];
      lastName = parts.slice(1).join(" ");
    }
    out.push({ email, firstName: firstName || undefined, lastName: lastName || undefined });
  });
  return { people: out, badRows, duplicates };
}
