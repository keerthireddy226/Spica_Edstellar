// Keeps the local file folders (uploads/ and private/) mirrored in Supabase
// Storage, for hosts whose disk is wiped on restart (a free Hugging Face Space).
// The app keeps reading and writing local files as before: on start the files
// are downloaded from the bucket, and a scan every few seconds uploads new or
// changed files and removes deleted ones from the bucket.
//
// Off unless SUPABASE_URL, SUPABASE_SERVICE_KEY and FILE_MIRROR_BUCKET are set,
// so local development is unchanged.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = ["uploads", "private"];
const SCAN_MS = 15_000;

interface Config {
  url: string;
  key: string;
  bucket: string;
}

function config(): Config | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.FILE_MIRROR_BUCKET;
  return url && key && bucket ? { url, key, bucket } : null;
}

const headers = (c: Config, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${c.key}`, apikey: c.key, ...extra });
const objectUrl = (c: Config, key: string) => `${c.url}/storage/v1/object/${c.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

// Every object under a prefix (the list call returns one folder level at a time).
async function listAll(c: Config, prefix: string): Promise<{ key: string; size: number }[]> {
  const out: { key: string; size: number }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${c.url}/storage/v1/object/list/${c.bucket}`, {
      method: "POST",
      headers: headers(c, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit: 1000, offset }),
    });
    if (!r.ok) throw new Error(`list ${prefix}: ${r.status} ${await r.text()}`);
    const rows = (await r.json()) as { name: string; id: string | null; metadata: { size?: number } | null }[];
    for (const row of rows) {
      const key = prefix ? `${prefix}/${row.name}` : row.name;
      if (row.id === null) out.push(...(await listAll(c, key)));
      else out.push({ key, size: row.metadata?.size ?? -1 });
    }
    if (rows.length < 1000) return out;
  }
}

async function localFiles(): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const files = new Map<string, { size: number; mtimeMs: number }>();
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        const s = await stat(p).catch(() => null);
        if (s) files.set(p.split(path.sep).join("/"), { size: s.size, mtimeMs: s.mtimeMs });
      }
    }
  }
  for (const root of ROOTS) await walk(root);
  return files;
}

// What the bucket holds, as last seen: local path -> size and mtime when uploaded.
let synced = new Map<string, { size: number; mtimeMs: number }>();
let running = false;

async function upload(c: Config, key: string) {
  const r = await fetch(objectUrl(c, key), {
    method: "POST",
    headers: headers(c, { "x-upsert": "true", "Content-Type": "application/octet-stream" }),
    body: await readFile(key),
  });
  if (!r.ok) throw new Error(`upload ${key}: ${r.status} ${await r.text()}`);
}

async function remove(c: Config, keys: string[]) {
  const r = await fetch(`${c.url}/storage/v1/object/${c.bucket}`, {
    method: "DELETE",
    headers: headers(c, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: keys }),
  });
  if (!r.ok) throw new Error(`delete: ${r.status} ${await r.text()}`);
}

async function scan(c: Config) {
  if (running) return;
  running = true;
  try {
    const now = await localFiles();
    for (const [key, f] of now) {
      const before = synced.get(key);
      if (before && before.size === f.size && before.mtimeMs === f.mtimeMs) continue;
      try {
        await upload(c, key);
        synced.set(key, f);
      } catch (err) {
        console.error("[file-mirror]", (err as Error).message);
      }
    }
    const gone = [...synced.keys()].filter((k) => !now.has(k));
    for (let i = 0; i < gone.length; i += 100) {
      const batch = gone.slice(i, i + 100);
      try {
        await remove(c, batch);
        for (const k of batch) synced.delete(k);
      } catch (err) {
        console.error("[file-mirror]", (err as Error).message);
      }
    }
  } finally {
    running = false;
  }
}

// Downloads the bucket's files that aren't on disk yet, then starts the scan.
// Runs before the server listens, so files are there for the first request.
export async function startFileMirror(): Promise<void> {
  const c = config();
  if (!c) return;
  const started = Date.now();
  await fetch(`${c.url}/storage/v1/bucket`, {
    method: "POST",
    headers: headers(c, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: c.bucket, name: c.bucket, public: false }),
  }).catch(() => null);

  let remote: { key: string; size: number }[];
  try {
    remote = (await Promise.all(ROOTS.map((r) => listAll(c, r)))).flat();
  } catch (err) {
    // Start without the old files rather than not at all; nothing is deleted
    // from the bucket, since nothing counts as synced yet.
    console.error("[file-mirror] could not list the bucket:", (err as Error).message);
    remote = [];
  }
  const local = await localFiles();
  let downloaded = 0;
  const queue = remote.filter((o) => local.get(o.key)?.size !== o.size);
  // A few downloads at a time.
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let o = queue.shift(); o; o = queue.shift()) {
        const r = await fetch(objectUrl(c, o.key), { headers: headers(c) });
        if (!r.ok) {
          console.error(`[file-mirror] download ${o.key}: ${r.status}`);
          continue;
        }
        await mkdir(path.dirname(o.key), { recursive: true });
        await writeFile(o.key, Buffer.from(await r.arrayBuffer()));
        downloaded++;
      }
    }),
  );
  // Everything now on disk that the bucket has counts as synced.
  const after = await localFiles();
  const inBucket = new Set(remote.map((o) => o.key));
  synced = new Map([...after].filter(([k]) => inBucket.has(k)));
  console.log(`[file-mirror] ${remote.length} files in ${c.bucket}, ${downloaded} downloaded in ${Math.round((Date.now() - started) / 1000)}s`);
  setInterval(() => void scan(c), SCAN_MS).unref();
  void scan(c);
}

// One-off seeding: uploads every local file the bucket doesn't have yet
// (deploy/huggingface/copy-data.sh runs it from the machine with the files).
export async function pushAllFiles(): Promise<number> {
  const c = config();
  if (!c) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_KEY and FILE_MIRROR_BUCKET must be set");
  await fetch(`${c.url}/storage/v1/bucket`, {
    method: "POST",
    headers: headers(c, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: c.bucket, name: c.bucket, public: false }),
  }).catch(() => null);
  const remote = new Map((await Promise.all(ROOTS.map((r) => listAll(c, r)))).flat().map((o) => [o.key, o.size]));
  const queue = [...(await localFiles())].filter(([k, f]) => remote.get(k) !== f.size).map(([k]) => k);
  const total = queue.length;
  let done = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let k = queue.shift(); k; k = queue.shift()) {
        await upload(c, k).catch((err) => console.error("[file-mirror]", (err as Error).message));
        if (++done % 200 === 0) console.log(`[file-mirror] ${done}/${total}`);
      }
    }),
  );
  return total;
}
