// One-off: item_audio.duration_ms was estimated at 32 kbps but Google's MP3s
// are 64 kbps, so every stored length was double. Measures each file again.
// Usage: npx tsx scripts/fixAudioDurations.ts [--apply]
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/db.js";
import { mp3DurationMs } from "../src/voice/mp3.js";

const apply = process.argv.includes("--apply");
const rows = (await pool.query(`SELECT id, uri, duration_ms FROM item_audio`)).rows;
let fixed = 0;
let missing = 0;
let ratio = 0;
for (const r of rows) {
  const buf = await readFile(path.join(process.cwd(), r.uri.replace(/^\//, ""))).catch(() => null);
  if (!buf) {
    missing++;
    continue;
  }
  const ms = mp3DurationMs(buf);
  if (ms > 0) ratio += r.duration_ms / ms;
  if (ms > 0 && Math.abs(ms - r.duration_ms) > 200) {
    fixed++;
    if (apply) await pool.query(`UPDATE item_audio SET duration_ms = $2 WHERE id = $1`, [r.id, ms]);
  }
}
console.log(`${rows.length} recordings, ${fixed} with a wrong length${apply ? " (fixed)" : ""}, ${missing} files missing, stored/real ratio ${(ratio / (rows.length - missing)).toFixed(2)}`);
await pool.end();
