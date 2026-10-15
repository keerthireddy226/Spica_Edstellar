// Reads the machine-readable zone (the two or three lines of capital letters
// and "<" at the bottom of a passport or ID card) from a photo of the
// document, checks its check digits, and compares the name and expiry date
// with the account. Works for any ICAO 9303 document worldwide (passports,
// most national ID cards). Documents without an MRZ go to the reviewer as
// they are. Runs locally with Tesseract; the image never leaves the server.
import path from "node:path";
import sharp from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { parse } from "mrz";

const LANG_DIR = path.join(process.cwd(), "models");

let workerPromise: Promise<Worker> | null = null;
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker("eng", 1, { langPath: LANG_DIR, cacheMethod: "none", gzip: true });
      await w.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });
      return w;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export interface MrzResult {
  format: string;
  // Every check digit adds up: the strip wasn't edited or misread.
  checksumsValid: boolean;
  documentNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  nationality: string | null;
  birthDate: string | null;
  expirationDate: string | null;
  expired: boolean | null;
  // The account's name appears in the document's name fields.
  nameMatches: boolean | null;
}

// MRZ line lengths: 44 (passport, TD3), 36 (TD2), 30 (ID card, TD1).
const LINE = /[A-Z0-9<]{28,52}/g;
// Tesseract's general English model often reads the "<" filler as one of these.
const FILLER = /[<KLC]/;

// A run of filler at the end of a line, possibly misread, back to "<".
function clearTrailingFiller(line: string, len: number): string {
  const m = line.match(/[<KLC]{3,}$/);
  const kept = m && (m[0].match(/</g)?.length ?? 0) >= 2 ? line.slice(0, line.length - m[0].length) : line;
  return kept.slice(0, len).padEnd(len, "<");
}

// Second line of a passport (TD3): fixed positions, with the optional
// personal-number field often pure filler.
function fixPassportLine2(line: string): string {
  if (line.length < 44) return line.padEnd(44, "<");
  const head = line.slice(0, 28);
  const tail = line.slice(-2);
  const middle = line.slice(28, -2);
  const personal = [...middle].every((c) => FILLER.test(c)) ? "<".repeat(14) : middle.slice(0, 14).padEnd(14, "<");
  // The personal number's check digit is "<" or "0" when the field is empty.
  return head + personal + tail;
}

function candidateLines(text: string): string[][] {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, "").toUpperCase())
    .map((l) => l.match(LINE)?.[0] ?? "")
    .filter((l) => l.length >= 28 && (l.includes("<<") || /^[A-Z0-9<]{30,46}$/.test(l)));
  const out: string[][] = [];
  // Passport: a name line starting with P, then a line of numbers and codes.
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/^P/.test(lines[i]) && lines[i + 1].length >= 40) out.push([clearTrailingFiller(lines[i], 44), fixPassportLine2(lines[i + 1])]);
  }
  for (const [len, count] of [
    [36, 2],
    [30, 3],
  ] as const) {
    const fit = lines.filter((l) => Math.abs(l.length - len) <= 3).map((l) => clearTrailingFiller(l, len));
    for (let i = 0; i + count <= fit.length; i++) out.push(fit.slice(i, i + count));
  }
  return out;
}

// YYMMDD from the MRZ. Expiry years are always taken as 20YY.
function expiryDate(yymmdd: string | null): Date | null {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null;
  return new Date(Date.UTC(2000 + Number(yymmdd.slice(0, 2)), Number(yymmdd.slice(2, 4)) - 1, Number(yymmdd.slice(4, 6))));
}

function normalizeName(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// Names on the MRZ drop accents, are cut at the line length, and the OCR can
// add or swap a letter, so a word matches if it is one or two edits away.
function wordMatches(doc: string, mine: string): boolean {
  if (doc === mine) return true;
  if (doc.length >= 4 && mine.startsWith(doc)) return true;
  return editDistance(doc, mine) <= (mine.length >= 8 ? 2 : 1);
}

function nameMatches(accountName: string, first: string | null, last: string | null): boolean | null {
  const mine = normalizeName(accountName);
  const doc = normalizeName(`${first ?? ""} ${last ?? ""}`);
  if (mine.length === 0 || doc.length === 0) return null;
  return mine.every((w) => doc.some((d) => wordMatches(d, w)));
}

// Single letters left between fillers are misread "<", not initials.
function cleanName(s: string | null | undefined): string | null {
  if (!s) return null;
  const words = s.split(/\s+/).filter((w) => w.length > 1 || !/[KLC]/.test(w));
  return words.join(" ").trim() || null;
}

const CHECK_FIELDS = ["documentNumberCheckDigit", "birthDateCheckDigit", "expirationDateCheckDigit", "compositeCheckDigit"];

export async function readMrz(image: Buffer, accountName: string): Promise<MrzResult | null> {
  // The MRZ sits in the lower part of the page; read that, larger and in grey.
  const meta = await sharp(image).rotate().metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return null;
  const worker = await getWorker();
  const tries = [
    { top: Math.round(h * 0.6), height: h - Math.round(h * 0.6) },
    { top: 0, height: h },
  ];
  // Every reading from every crop; the one whose check digits hold wins.
  const found: MrzResult[] = [];
  for (const t of tries) {
    const crop = await sharp(image)
      .rotate()
      .extract({ left: 0, top: t.top, width: w, height: t.height })
      .resize({ width: 1800 })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
    const { data } = await worker.recognize(crop);
    for (const lines of candidateLines(data.text)) {
      let result;
      try {
        result = parse(lines, { autocorrect: true });
      } catch {
        continue;
      }
      const f = result.fields;
      if (!f.documentNumber && !f.lastName) continue;
      const exp = expiryDate(f.expirationDate ?? null);
      // The check digits cover the number and dates, not the names.
      const checks = result.details.filter((d) => CHECK_FIELDS.includes(String(d.field)));
      const firstName = cleanName(f.firstName);
      const lastName = cleanName(f.lastName);
      found.push({
        format: result.format,
        checksumsValid: checks.length > 0 && checks.every((d) => d.valid),
        documentNumber: f.documentNumber ?? null,
        firstName,
        lastName,
        nationality: f.nationality ?? null,
        birthDate: f.birthDate ?? null,
        expirationDate: f.expirationDate ?? null,
        expired: exp ? exp.getTime() < Date.now() : null,
        nameMatches: nameMatches(accountName, firstName, lastName),
      });
    }
    if (found.some((r) => r.checksumsValid)) break;
  }
  const score = (r: MrzResult) => (r.checksumsValid ? 4 : 0) + (r.expirationDate ? 1 : 0) + (r.birthDate ? 1 : 0) + (r.nameMatches ? 1 : 0);
  return found.sort((a, b) => score(b) - score(a))[0] ?? null;
}
