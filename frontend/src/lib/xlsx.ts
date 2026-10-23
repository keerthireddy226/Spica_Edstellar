// Reads the first sheet of an Excel (.xlsx) file into rows of text, without a
// library: an .xlsx file is a zip of XML files, and the browser can inflate
// zip entries itself (DecompressionStream "deflate-raw"). Enough for simple
// lists such as names and email addresses; formulas give their saved value.

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The zip's files, by name, from its central directory.
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  // The end-of-central-directory record is in the last 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not_a_zip");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    out.set(name, decoder.decode(method === 8 ? await inflate(raw) : raw));
  }
  return out;
}

// "C12" -> column index 2.
function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(file: Blob): Promise<string[][]> {
  const files = await unzip(await file.arrayBuffer(), (n) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
  const shared = files.has("xl/sharedStrings.xml")
    ? [...parse(files.get("xl/sharedStrings.xml")!).getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""))
    : [];
  // The first sheet in the file (usually sheet1).
  const sheetName = [...files.keys()].filter((n) => n.startsWith("xl/worksheets/")).sort()[0];
  if (!sheetName) throw new Error("no_sheet");
  const sheet = parse(files.get(sheetName)!);
  const rows: string[][] = [];
  for (const row of sheet.getElementsByTagName("row")) {
    const cells: string[] = [];
    for (const c of row.getElementsByTagName("c")) {
      const ref = c.getAttribute("r") ?? "";
      const i = ref ? columnIndex(ref) : cells.length;
      const type = c.getAttribute("t");
      let value = "";
      if (type === "inlineStr") value = [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("");
      else {
        const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        value = type === "s" ? (shared[Number(v)] ?? "") : v;
      }
      cells[i] = value.trim();
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}
