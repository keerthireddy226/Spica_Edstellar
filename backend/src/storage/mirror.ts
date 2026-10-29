// Keeps the local file folders (uploads/ and private/) mirrored in Supabase
// Storage, for hosts whose disk is wiped on restart (a free Hugging Face Space).
// The app keeps reading and writing local files as before: on start the files
// are downloaded from the bucket, and a scan every few seconds uploads new or
// changed files and removes deleted ones from the bucket.
//
// Off unless SUPABASE_URL, SUPABASE_SERVICE_KEY and FILE_MIRROR_BUCKET are set,
// so local development is unchanged.
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const ROOTS = ["uploads", "private"];
const SCAN_MS = 15_000;
// Downloads land here first (outside the mirrored folders), then move in.
const TMP_DIR = ".file-mirror-tmp";

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

// Every reply must be read or closed. An unread body leaves its connection
// paused; when the server later closes it, Node's fetch (undici) fails an
// internal assert(!this.paused) outside any try/catch and the process exits
// (the Render crashes of 2026-10-22, a few minutes after each start).
async function discard(r: globalThis.Response): Promise<void> {
  await r.body?.cancel().catch(() => {});
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
// Files missing at the last scan: removed from the bucket only if still
// missing at the next one.
let missingBefore = new Set<string>();
// Deletions wait until the start-up download has finished.
let restoring = false;

async function upload(c: Config, key: string) {
  const r = await fetch(objectUrl(c, key), {
    method: "POST",
    headers: headers(c, { "x-upsert": "true", "Content-Type": "application/octet-stream" }),
    body: await readFile(key),
  });
  if (!r.ok) throw new Error(`upload ${key}: ${r.status} ${await r.text()}`);
  await discard(r);
}

async function remove(c: Config, keys: string[]) {
  const r = await fetch(`${c.url}/storage/v1/object/${c.bucket}`, {
    method: "DELETE",
    headers: headers(c, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: keys }),
  });
  if (!r.ok) throw new Error(`delete: ${r.status} ${await r.text()}`);
  await discard(r);
}

async function scan(c: Config) {
  if (running) return;
  running = true;
  try {
    // Only files known before this scan can count as deleted: one downloaded
    // while the scan walks the folders isn't in its snapshot, and used to be
    // removed from the bucket by mistake.
    const knownBefore = new Set(synced.keys());
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
    const missing = new Set<string>();
    if (!restoring) {
      for (const k of knownBefore) {
        if (now.has(k) || !synced.has(k)) continue;
        // Really gone from disk, not a folder that couldn't be read.
        const st = await stat(k).catch((err: NodeJS.ErrnoException) => (err.code === "ENOENT" ? null : "unknown"));
        if (st === null) missing.add(k);
      }
    }
    const gone = [...missing].filter((k) => missingBefore.has(k));
    missingBefore = new Set([...missing].filter((k) => !gone.includes(k)));
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

// Lists the bucket and starts the scan; files not on disk yet are downloaded
// in the background, or on demand when asked for first.
export async function startFileMirror(): Promise<void> {
  const c = config();
  if (!c) return;
  const started = Date.now();
  await fetch(`${c.url}/storage/v1/bucket`, {
    method: "POST",
    headers: headers(c, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: c.bucket, name: c.bucket, public: false }),
  })
    // Usually "already exists": the reply isn't needed, but it must be closed.
    .then(discard)
    .catch(() => null);

  let remote: { key: string; size: number }[];
  try {
    remote = (await Promise.all(ROOTS.map((r) => listAll(c, r)))).flat();
  } catch (err) {
    // Start without the old files rather than not at all; nothing is deleted
    // from the bucket, since nothing counts as synced yet.
    console.error("[file-mirror] could not list the bucket:", (err as Error).message);
    remote = [];
  }
  for (const o of remote) remoteKeys.add(o.key);
  const local = await localFiles();
  const queue = remote.filter((o) => local.get(o.key)?.size !== o.size);
  // Files already on disk and in the bucket count as synced.
  synced = new Map([...local].filter(([k]) => remoteKeys.has(k)));
  console.log(`[file-mirror] ${remote.length} files in ${c.bucket}, ${queue.length} to download`);
  active = c;
  setInterval(() => void scan(c), SCAN_MS).unref();
  // Download in the background (a few at a time) so the server starts at
  // once; a file asked for before its turn is fetched on demand.
  let downloaded = 0;
  restoring = true;
  void Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let o = queue.shift(); o; o = queue.shift()) if (await ensureLocal(o.key)) downloaded++;
    }),
  ).then(() => {
    restoring = false;
    console.log(`[file-mirror] ${downloaded} files downloaded in ${Math.round((Date.now() - started) / 1000)}s`);
  });
}

// The bucket's files, and the mirror once started.
const remoteKeys = new Set<string>();
let active: Config | null = null;
const inFlight = new Map<string, Promise<boolean>>();

// Downloads one bucket file to its local path unless it's already there.
// Written to a temporary file first, so the scan never uploads half a file.
function ensureLocal(key: string): Promise<boolean> {
  const c = active;
  if (!c || !remoteKeys.has(key)) return Promise.resolve(false);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const job = (async () => {
    if (await stat(key).catch(() => null)) return false;
    const r = await fetch(objectUrl(c, key), { headers: headers(c) });
    if (!r.ok) {
      console.error(`[file-mirror] download ${key}: ${r.status}`);
      await discard(r);
      return false;
    }
    const tmp = path.join(TMP_DIR, `${randomUUID()}`);
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(tmp, Buffer.from(await r.arrayBuffer()));
    await mkdir(path.dirname(key), { recursive: true });
    await rename(tmp, key);
    const st = await stat(key);
    synced.set(key, { size: st.size, mtimeMs: st.mtimeMs });
    return true;
  })()
    .catch((err) => {
      console.error(`[file-mirror] download ${key}:`, (err as Error).message);
      return false;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

// A private proctoring file (served by its own endpoint, not express.static)
// that isn't downloaded yet after a restart: fetched now.
export function ensurePrivateFile(rel: string): Promise<boolean> {
  return ensureLocal(`private/proctoring/${rel}`);
}

// Before express.static("uploads"): a file not downloaded yet is fetched now.
export function mirrorMissingUploads(req: Request, _res: Response, next: NextFunction) {
  if (!active) return next();
  let rel: string;
  try {
    rel = path.posix.normalize(decodeURIComponent(req.path));
  } catch {
    return next();
  }
  const key = `uploads${rel}`;
  if (rel.includes("..") || !key.startsWith("uploads/")) return next();
  ensureLocal(key).finally(() => next());
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
  })
    // Usually "already exists": the reply isn't needed, but it must be closed.
    .then(discard)
    .catch(() => null);
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
