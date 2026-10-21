// What a learner owns, in one place: Full access (a live licence or the Plus
// plan), preparation for one test, and certified attempts (a test or a level
// test). The server's checks and the app's menus, home page and locks all
// read this.
import { pool } from "../db.js";
import { learnerAccess, type LearnerAccess } from "../licenses/service.js";

// Preparation can be switched to another test in its first SWITCH_DAYS (see assessment/service.ts).
const SWITCH_DAYS = 7;

export type ProductKind = "full" | "prep" | "assessment" | "level" | "pack" | "final";

export interface EntitlementRow {
  id: string;
  product_id: string;
  kind: ProductKind;
  name: string;
  test_type_id: string | null;
  level: string | null;
  attempts_total: number;
  attempts_used: number;
  starts_at: Date | string;
  ends_at: Date | string;
  switched_at?: Date | string | null;
}

export interface Owned {
  id: string;
  productId: string;
  kind: ProductKind;
  name: string;
  testTypeId: string | null;
  level: string | null;
  attemptsLeft: number;
  startsAt: string;
  endsAt: string;
  // Preparation not yet started or switched: it can move to another test until then.
  canSwitchUntil: string | null;
}

export interface Access {
  // A live licence or plan: everything is open.
  full: { endsAt: string | null } | null;
  // Tests the learner prepares for (practice tests, mocks, their Practice Modules question types).
  prepTests: string[];
  // A practice pack: every Practice Modules question type (no tests).
  practicePack: boolean;
  // Everything owned besides Full access, still valid (with or without attempts left).
  owned: Owned[];
  // Certified attempts that can still be started.
  attempts: Owned[];
}

const iso = (d: Date | string) => new Date(d).toISOString();

// Pure: what the licence status and the owned rows add up to at `now`.
export function resolveAccess(licence: Pick<LearnerAccess, "status" | "accessEndsAt" | "graceEndsAt"> | null, rows: EntitlementRow[], now = new Date()): Access {
  const live = licence && (licence.status === "active" || licence.status === "grace");
  const valid = rows.filter((r) => new Date(r.starts_at) <= now && new Date(r.ends_at) > now);
  const owned: Owned[] = valid.map((r) => ({
    id: r.id,
    productId: r.product_id,
    kind: r.kind,
    name: r.name,
    testTypeId: r.test_type_id,
    level: r.level,
    attemptsLeft: Math.max(0, r.attempts_total - r.attempts_used),
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    canSwitchUntil:
      r.kind === "prep" && r.attempts_used === 0 && !r.switched_at && new Date(r.starts_at).getTime() + SWITCH_DAYS * 86_400_000 > now.getTime()
        ? new Date(new Date(r.starts_at).getTime() + SWITCH_DAYS * 86_400_000).toISOString()
        : null,
  }));
  return {
    full: live ? { endsAt: licence!.status === "grace" ? licence!.graceEndsAt : licence!.accessEndsAt } : owned.some((o) => o.kind === "full") ? { endsAt: owned.filter((o) => o.kind === "full").map((o) => o.endsAt).sort().pop() ?? null } : null,
    prepTests: [...new Set(owned.filter((o) => o.kind === "prep" && o.testTypeId).map((o) => o.testTypeId!))],
    practicePack: owned.some((o) => o.kind === "pack"),
    owned,
    attempts: owned.filter((o) => o.attemptsLeft > 0 && o.kind !== "full" && o.kind !== "pack"),
  };
}

export async function ownedRows(userId: string): Promise<EntitlementRow[]> {
  return (
    await pool.query(
      `SELECT e.id, e.product_id, p.kind, p.name, e.test_type_id, e.level, e.attempts_total, e.attempts_used, e.starts_at, e.ends_at, e.switched_at
       FROM entitlements e JOIN products p ON p.id = e.product_id
       WHERE e.user_id = $1 AND e.revoked_at IS NULL AND e.ends_at > now()
       ORDER BY e.ends_at`,
      [userId],
    )
  ).rows;
}

export async function accessOf(userId: string): Promise<Access> {
  const [licence, rows] = await Promise.all([learnerAccess(userId), ownedRows(userId)]);
  return resolveAccess(licence, rows);
}

// Whether the learner owns anything that opens part of Spica without a licence.
export function ownsSomething(a: Access): boolean {
  return !!a.full || a.owned.length > 0;
}

// The test can be practised (its practice tests and mock tests).
export function canPrepare(a: Access, testTypeId: string | null | undefined): boolean {
  return !!a.full || (!!testTypeId && a.prepTests.includes(testTypeId));
}

// The question types of a set of tests (from their parts), for Practice Modules.
export async function itemTypesOfTests(testTypeIds: string[]): Promise<string[]> {
  if (!testTypeIds.length) return [];
  const r = await pool.query(
    `SELECT DISTINCT p.item_type_id FROM exam_parts p JOIN exams e ON e.id = p.exam_id WHERE e.test_type_id = ANY($1::text[]) AND p.item_type_id IS NOT NULL`,
    [testTypeIds],
  );
  return r.rows.map((x) => x.item_type_id as string);
}

// Practice Modules question types the learner may practise: all with Full
// access, else those of the tests they prepare for (null = no limit).
export async function allowedItemTypes(a: Access): Promise<string[] | null> {
  if (a.full || a.practicePack) return null;
  return itemTypesOfTests(a.prepTests);
}

// For the server's checks: null when nothing narrows access (Full access, or
// nothing owned so the licence and free-plan rules apply as before); else the
// learner's Access, which only opens what they own.
export async function narrowedAccess(userId: string): Promise<Access | null> {
  const a = await accessOf(userId);
  return a.full || !ownsSomething(a) ? null : a;
}
