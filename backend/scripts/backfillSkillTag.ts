// One-off: splits each multi-skill item type's existing practice-pool
// content into genuinely separate, non-overlapping slices per skill. A Set
// holds several items (5, here) answered together as one session — the
// split has to happen at the SET level, every item in a set getting the
// SAME skill_tag, round-robin by set position within the unit. (An earlier
// version of this script round-robinned individual items instead, which
// left most sets internally mixed — e.g. 3 listening-tagged items plus 2
// speaking-tagged ones in the same set — so picking "Set 2" from either
// skill tab still ran the exact same 5-item session either way.)
import "dotenv/config";
import { pool } from "../src/db.js";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode." : "DRY RUN — pass --apply to write.");

  const typesResult = await pool.query<{ id: string; skills: string[] }>(
    `SELECT id, skills FROM item_types WHERE array_length(skills, 1) > 1`,
  );

  let totalAssigned = 0;
  const client = await pool.connect();
  try {
    if (apply) await client.query("BEGIN");
    for (const type of typesResult.rows) {
      const setsResult = await client.query<{ set_id: string; unit_id: string }>(
        `SELECT DISTINCT s.id AS set_id, s.unit_id
         FROM items i JOIN sets s ON s.id = i.set_id
         WHERE i.pool = 'practice' AND i.status = 'approved' AND i.item_type_id = $1
         ORDER BY s.unit_id, s.id`,
        [type.id],
      );
      // Real set ordering (order_index) fetched separately since the
      // DISTINCT above can't carry it without breaking the dedup.
      const orderResult = await client.query<{ id: string; unit_id: string; order_index: number | null }>(
        `SELECT id, unit_id, order_index FROM sets WHERE id = ANY($1::uuid[])`,
        [setsResult.rows.map((r) => r.set_id)],
      );
      const unitsResult = await client.query<{ id: string; order_index: number | null }>(
        `SELECT id, order_index FROM units WHERE id = ANY($1::uuid[])`,
        [[...new Set(setsResult.rows.map((r) => r.unit_id))]],
      );
      const unitOrder = new Map(unitsResult.rows.map((r) => [r.id, r.order_index ?? 0]));

      const orderBySet = new Map(orderResult.rows.map((r) => [r.id, r.order_index ?? 0]));
      const perUnit = new Map<string, string[]>();
      for (const row of setsResult.rows) {
        const list = perUnit.get(row.unit_id) ?? [];
        list.push(row.set_id);
        perUnit.set(row.unit_id, list);
      }
      for (const [, setIds] of perUnit) setIds.sort((a, b) => orderBySet.get(a)! - orderBySet.get(b)!);

      // Units sorted so the starting skill can rotate per unit below —
      // each unit alone round-robins unevenly when its set count isn't a
      // multiple of the skill count (e.g. 3 sets / 2 skills = 2:1), so
      // rotating which skill goes first evens it out across all units
      // instead of the same skill winning the extra set every time.
      const unitsInOrder = [...perUnit.keys()].sort((a, b) => unitOrder.get(a)! - unitOrder.get(b)!);

      const counts: Record<string, number> = {};
      for (const skill of type.skills) counts[skill] = 0;
      for (let unitIndex = 0; unitIndex < unitsInOrder.length; unitIndex++) {
        const setIds = perUnit.get(unitsInOrder[unitIndex])!;
        const startOffset = unitIndex % type.skills.length;
        for (let i = 0; i < setIds.length; i++) {
          const setId = setIds[i];
          const skill = type.skills[(i + startOffset) % type.skills.length];
          counts[skill]++;
          if (apply) {
            const r = await client.query(`UPDATE items SET skill_tag = $1 WHERE set_id = $2`, [skill, setId]);
            totalAssigned += r.rowCount ?? 0;
          } else {
            const r = await client.query(`SELECT count(*)::int AS n FROM items WHERE set_id = $1`, [setId]);
            totalAssigned += r.rows[0].n;
          }
        }
      }
      console.log(`${type.id}: ${JSON.stringify(counts)} sets`);
    }
    if (apply) {
      await client.query("COMMIT");
      console.log(`Applied: assigned skill_tag to ${totalAssigned} items.`);
    } else {
      console.log(`Would assign skill_tag to ${totalAssigned} items.`);
    }
  } catch (err) {
    if (apply) await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((err) => {
  console.error("backfillSkillTag: fatal error:", err);
  process.exit(1);
});
