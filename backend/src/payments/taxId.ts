// Format checks (and checksums where they're public) for the tax IDs that go
// on invoices. Catches typos before an invoice is issued with a wrong number;
// it doesn't confirm the ID is registered.

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function gstinChecksumOk(g: string): boolean {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(g[i]);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
}

function abnChecksumOk(abn: string): boolean {
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const d = abn.split("").map(Number);
  d[0] -= 1;
  return d.reduce((s, x, i) => s + x * w[i], 0) % 89 === 0;
}

// EU VAT: country prefix + national pattern.
const EU_VAT: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE[01]\d{9}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-HJ-NP-Z0-9]{2}\d{9}$/,
  GR: /^EL\d{9}$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE\d{7}[A-W][A-I]?$|^IE\d[A-Z+*]\d{5}[A-W]$/,
  IT: /^IT\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
};

export function normalizeTaxId(raw: string): string {
  return raw.replace(/[\s.\-/]/g, "").toUpperCase();
}

// null = looks valid (or the country has no specific rule); otherwise why not.
export function taxIdProblem(country: string | null | undefined, raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const id = normalizeTaxId(raw);
  const c = (country ?? "").toUpperCase();
  if (c === "IN") {
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(id)) return "A GSTIN has 15 characters, like 29ABCDE1234F1Z5.";
    if (!gstinChecksumOk(id)) return "That GSTIN's check digit doesn't match — please re-check it.";
    return null;
  }
  if (c === "AU") {
    if (!/^\d{11}$/.test(id) || !abnChecksumOk(id)) return "That isn't a valid 11-digit ABN.";
    return null;
  }
  if (c === "GB") return /^(GB)?(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/.test(id) ? null : "A UK VAT number looks like GB123456789.";
  if (c === "US") return /^\d{9}$/.test(id) ? null : "An EIN has 9 digits, like 12-3456789.";
  if (c === "GR" || EU_VAT[c]) {
    const withPrefix = id.startsWith(c === "GR" ? "EL" : c) ? id : `${c === "GR" ? "EL" : c}${id}`;
    return EU_VAT[c]?.test(withPrefix) ? null : `That doesn't look like a ${c} VAT number.`;
  }
  return /^[A-Z0-9]{4,30}$/.test(id) ? null : "Tax IDs use only letters and digits.";
}
