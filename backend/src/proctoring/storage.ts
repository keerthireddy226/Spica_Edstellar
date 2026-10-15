// Proctoring files (snapshots, room scans, voice samples, ID images) are kept
// outside the uploads folder, which any signed-in user can read by path.
// They are served only through the reviewer endpoints.
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const PRIVATE_ROOT = path.resolve("private", "proctoring");

export async function saveMedia(kind: string, ext: string, data: Buffer): Promise<string> {
  const dir = path.join(PRIVATE_ROOT, kind);
  await mkdir(dir, { recursive: true });
  const rel = `${kind}/${randomUUID()}.${ext}`;
  await writeFile(path.join(PRIVATE_ROOT, rel), data);
  return rel;
}

// Resolves a stored uri, refusing anything that escapes the storage root.
export function mediaPath(uri: string): string | null {
  const file = path.resolve(PRIVATE_ROOT, uri);
  return file.startsWith(PRIVATE_ROOT + path.sep) ? file : null;
}

export async function removeMedia(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  const file = mediaPath(uri);
  if (file) await unlink(file).catch(() => {});
}
