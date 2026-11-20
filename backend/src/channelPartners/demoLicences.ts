// Channel Partners stage 3: demo licences inside a partner's organisation.
// A demo licence is an entitlement to the inactive 'partner_demo' product: a
// 7-day preparation for English 4 Skills Essentials with no real test, so the
// existing preparation rules already limit Practice Modules, practice tests and
// mocks to that test, and no final assessment or certificate is possible.
// On top: 2 practice tests and 1 mock in the 7 days, and the mock opens after
// one practice test has been finished.
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { recordAudit } from "../audit/service.js";
import { demoStatus } from "./staffRoutes.js";

export const DEMO_PRODUCT = "partner_demo";
export const DEMO_DAYS = 7;
// After a learner's 7 days: 3 days to sign in, see results and move to a paid
// licence, without practising; after that sign-in is closed until a paid
// licence is given (user, 19 Nov 2026).
export const DEMO_GRACE_DAYS = 3;
export const DEMO_PRACTICE_TESTS = 2;
export const DEMO_MOCKS = 1;

export interface DemoState {
  entitlementId: string;
  startsAt: string;
  endsAt: string;
  practiceUsed: number;
  practiceDone: number;
  mocksUsed: number;
  practiceLeft: number;
  mocksLeft: number;
  mockUnlocked: boolean;
}

// The learner's current demo licence and what's left of it (null if none).
export async function demoState(userId: string): Promise<DemoState | null> {
  const e = (
    await pool.query(
      `SELECT id, starts_at, ends_at FROM entitlements WHERE user_id = $1 AND source = 'partner_demo' AND revoked_at IS NULL AND starts_at <= now() AND ends_at > now()
         -- A paid licence running replaces the demo and its limits.
         AND NOT EXISTS (SELECT 1 FROM license_assignments a WHERE a.user_id = $1 AND a.reclaimed_at IS NULL AND a.starts_at <= now() AND a.ends_at > now())
       ORDER BY ends_at DESC LIMIT 1`,
      [userId],
    )
  ).rows[0];
  if (!e) return null;
  const s = (
    await pool.query(
      `SELECT count(*) FILTER (WHERE delivery_mode = 'practice')::int AS practice,
         count(*) FILTER (WHERE delivery_mode = 'practice' AND completed_at IS NOT NULL)::int AS practice_done,
         count(*) FILTER (WHERE delivery_mode = 'mock')::int AS mocks
       FROM sessions WHERE user_id = $1 AND session_type = 'mocktest' AND started_at >= $2`,
      [userId, e.starts_at],
    )
  ).rows[0];
  return {
    entitlementId: e.id,
    startsAt: new Date(e.starts_at).toISOString(),
    endsAt: new Date(e.ends_at).toISOString(),
    practiceUsed: s.practice,
    practiceDone: s.practice_done,
    mocksUsed: s.mocks,
    practiceLeft: Math.max(0, DEMO_PRACTICE_TESTS - s.practice),
    mocksLeft: Math.max(0, DEMO_MOCKS - s.mocks),
    mockUnlocked: s.practice_done >= 1,
  };
}

// Had a demo licence that has ended, with nothing else open (for "talk to us").
export async function demoEnded(userId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM entitlements WHERE user_id = $1 AND source = 'partner_demo' AND ends_at <= now()
       AND NOT EXISTS (SELECT 1 FROM license_assignments a WHERE a.user_id = $1 AND a.reclaimed_at IS NULL AND a.ends_at > now()) LIMIT 1`,
    [userId],
  );
  return !!r.rowCount;
}

// Where a demo learner stands after their 7 days: "grace" for 3 days (sign in,
// see results, move to paid; no practice), then "closed" (no sign-in until a
// paid licence). Null when the learner has no ended demo, or has a paid
// licence or another access running.
export async function demoAfterPhase(userId: string): Promise<{ phase: "grace" | "closed"; endedAt: string; graceUntil: string } | null> {
  const r = await pool.query(
    `SELECT e.ends_at FROM entitlements e WHERE e.user_id = $1 AND e.source = 'partner_demo' AND e.revoked_at IS NULL AND e.ends_at <= now()
       -- Only learners who never had anything but the demo: a paid licence or
       -- purchase, even one that has since ended, keeps sign-in open (results, certificates).
       AND NOT EXISTS (SELECT 1 FROM entitlements x WHERE x.user_id = $1 AND x.revoked_at IS NULL AND x.source IS DISTINCT FROM 'partner_demo')
       AND NOT EXISTS (SELECT 1 FROM license_assignments a WHERE a.user_id = $1 AND a.reclaimed_at IS NULL)
     ORDER BY e.ends_at DESC LIMIT 1`,
    [userId],
  );
  if (!r.rowCount) return null;
  const ended = new Date(r.rows[0].ends_at);
  const graceUntil = new Date(ended.getTime() + DEMO_GRACE_DAYS * 86400000);
  return { phase: graceUntil.getTime() > Date.now() ? "grace" : "closed", endedAt: ended.toISOString(), graceUntil: graceUntil.toISOString() };
}

// Whether a new practice test / mock may start under the demo (null = yes).
export function demoBlock(d: DemoState, mode: string, testTypeId: string | null): string | null {
  if (mode === "certified" || mode === "sample") return "demo_no_real_test";
  if (testTypeId && testTypeId !== "fourSkills") return "demo_test_not_included";
  if (mode === "practice" && d.practiceLeft <= 0) return "demo_practice_used";
  if (mode === "mock") {
    if (d.mocksLeft <= 0) return "demo_mock_used";
    if (!d.mockUnlocked) return "demo_mock_locked";
  }
  return null;
}

// How an organisation's demo licences stand: each learner's demo comes out of
// a gift that was already given and still valid that day, the earliest-ending
// first. Older data that fits no gift takes the first gift with any left.
// Unused licences of a gift past its date are expired, the rest are left.
export function splitDemoUse(
  gifts: { licences: number; createdAt: number; expired: boolean; vu: string | null }[],
  uses: { at: number; day: string }[],
): { left: number; expired: number; useBy: string | null } {
  const sorted = gifts
    .map((g, i) => ({ ...g, rest: g.licences, i }))
    .sort((a, b) => (a.vu ?? "9999").localeCompare(b.vu ?? "9999") || a.createdAt - b.createdAt || a.i - b.i);
  for (const u of [...uses].sort((a, b) => a.at - b.at)) {
    const g = sorted.find((x) => x.rest > 0 && x.createdAt <= u.at && (!x.vu || x.vu >= u.day)) ?? sorted.find((x) => x.rest > 0);
    if (g) g.rest -= 1;
  }
  let left = 0;
  let expired = 0;
  let useBy: string | null = null;
  for (const g of sorted) {
    if (g.expired) expired += g.rest;
    else if (g.rest > 0) {
      left += g.rest;
      if (g.vu && (!useBy || g.vu < useBy)) useBy = g.vu;
    }
  }
  return { left, expired, useBy };
}

// Demo licences a partner organisation has been given, and how many are used.
export async function orgDemoBalance(tenantId: string) {
  const t = (await pool.query(`SELECT channel_partner_id FROM tenants WHERE id = $1`, [tenantId])).rows[0];
  if (!t?.channel_partner_id) return null;
  const p = (await pool.query(`SELECT * FROM channel_partners WHERE id = $1`, [t.channel_partner_id])).rows[0];
  const gifts = (
    await pool.query(
      // A gift can be used until its date plus 3 days' grace; then the rest expires.
      `SELECT licences, created_at, (valid_until IS NOT NULL AND valid_until + 3 < current_date) AS expired, to_char(valid_until + 3, 'YYYY-MM-DD') AS vu
       FROM partner_allocations WHERE tenant_id = $1 AND kind = 'demo' ORDER BY valid_until NULLS LAST, created_at`,
      [tenantId],
    )
  ).rows.map((g) => ({ licences: g.licences as number, createdAt: new Date(g.created_at).getTime(), expired: g.expired as boolean, vu: g.vu as string | null }));
  const given = gifts.reduce((n, g) => n + g.licences, 0);
  // Each demo a learner got (not taken back), oldest first, with the day it was given.
  const uses = (
    await pool.query(
      `SELECT created_at, to_char(created_at AT TIME ZONE current_setting('TimeZone'), 'YYYY-MM-DD') AS day
       FROM entitlements WHERE tenant_id = $1 AND source = 'partner_demo' AND revoked_at IS NULL ORDER BY created_at`,
      [tenantId],
    )
  ).rows;
  const used = uses.length;
  const { left, expired, useBy: graceUntil } = splitDemoUse(gifts, uses.map((u) => ({ at: new Date(u.created_at).getTime(), day: u.day as string })));
  // splitDemoUse works on the last usable day (date + grace); the "use by" date shown is 3 days earlier.
  const useBy = graceUntil ? new Date(new Date(graceUntil + "T00:00:00Z").getTime() - 3 * 86400000).toISOString().slice(0, 10) : null;
  const inGrace = !!useBy && useBy < new Date().toISOString().slice(0, 10);
  return { partnerId: p.id as string, windowOpen: demoStatus(p) === "active" && !p.deactivated_at, windowEndsAt: (p.demo_ended_at ?? p.demo_ends_at) as Date | null, given, used, left, expired, useBy, graceUntil, inGrace };
}

export class DemoError extends Error {}

// Give one learner a 7-day demo licence (starts now).
export async function assignDemoLicence(args: { tenantId: string; userId: string; actorId: string | null }): Promise<{ endsAt: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`partner-demo:${args.tenantId}`]);
    const b = await orgDemoBalance(args.tenantId);
    if (!b) throw new DemoError("not_a_partner_organisation");
    if (!b.windowOpen) throw new DemoError("demo_window_not_open");
    if (b.left <= 0) throw new DemoError("no_demo_licences_left");
    const u = await client.query(`SELECT email FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'learner' AND deleted_at IS NULL`, [args.userId, args.tenantId]);
    if (!u.rowCount) throw new DemoError("learner_not_found");
    const has = await client.query(`SELECT 1 FROM entitlements WHERE user_id = $1 AND source = 'partner_demo' AND revoked_at IS NULL`, [args.userId]);
    if (has.rowCount) throw new DemoError("already_has_demo");
    const r = await client.query(
      `INSERT INTO entitlements (user_id, product_id, test_type_id, attempts_total, ends_at, source, tenant_id, granted_by)
       VALUES ($1, $2, 'fourSkills', 0, now() + make_interval(days => $3), 'partner_demo', $4, $5) RETURNING ends_at`,
      [args.userId, DEMO_PRODUCT, DEMO_DAYS, args.tenantId, args.actorId],
    );
    await client.query("COMMIT");
    await recordAudit({ tenantId: args.tenantId, actorId: args.actorId, action: "demo_licence.assigned", targetType: "learner", targetId: args.userId, targetLabel: u.rows[0].email, details: { days: DEMO_DAYS } });
    return { endsAt: new Date(r.rows[0].ends_at).toISOString() };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Take a demo licence back from a learner who hasn't started any test, so it
// can go to someone else.
export async function reclaimDemoLicence(args: { tenantId: string; userId: string; actorId: string }): Promise<void> {
  const e = (
    await pool.query(`SELECT id, starts_at FROM entitlements WHERE user_id = $1 AND tenant_id = $2 AND source = 'partner_demo' AND revoked_at IS NULL AND ends_at > now()`, [args.userId, args.tenantId])
  ).rows[0];
  if (!e) throw new DemoError("no_demo_licence");
  const started = await pool.query(`SELECT 1 FROM sessions WHERE user_id = $1 AND started_at >= $2 LIMIT 1`, [args.userId, e.starts_at]);
  if (started.rowCount) throw new DemoError("demo_already_used");
  await pool.query(`UPDATE entitlements SET revoked_at = now() WHERE id = $1`, [e.id]);
  await recordAudit({ tenantId: args.tenantId, actorId: args.actorId, action: "demo_licence.reclaimed", targetType: "learner", targetId: args.userId });
}

// Org Admin: the organisation's demo licences and its learners.
export const orgDemoRouter = Router();

orgDemoRouter.get("/", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "org_admin" || !req.user!.tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const b = await orgDemoBalance(req.user!.tenantId);
    if (!b) return res.json({ partnerOrganisation: false });
    const learners = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email,
         e.starts_at, e.ends_at,
         EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND e.starts_at IS NOT NULL AND s.started_at >= e.starts_at) AS started,
         EXISTS (SELECT 1 FROM license_assignments la WHERE la.user_id = u.id AND la.reclaimed_at IS NULL AND la.ends_at > now()) AS paid
       FROM users u
       LEFT JOIN LATERAL (SELECT * FROM entitlements x WHERE x.user_id = u.id AND x.source = 'partner_demo' AND x.revoked_at IS NULL ORDER BY x.ends_at DESC LIMIT 1) e ON true
       WHERE u.tenant_id = $1 AND u.role = 'learner' AND u.deleted_at IS NULL ORDER BY u.created_at DESC`,
      [req.user!.tenantId],
    );
    res.json({
      partnerOrganisation: true,
      demo: { given: b.given, used: b.used, left: b.left, expired: b.expired, useBy: b.useBy, graceUntil: b.graceUntil, inGrace: b.inGrace, graceDays: DEMO_GRACE_DAYS, windowOpen: b.windowOpen, windowEndsAt: b.windowEndsAt, days: DEMO_DAYS },
      upgrade: await (async () => {
        const [ids, p] = await Promise.all([demoLearnersToUpgrade(req.user!.tenantId!), partnerOrderPool(req.user!.tenantId!)]);
        return { demoLearners: ids.length, paidLicencesFree: Math.floor(p.freeMonths / p.licenceMonths), licenceMonths: p.licenceMonths };
      })(),
      learners: learners.rows.map((l) => ({
        id: l.id,
        name: [l.first_name, l.last_name].filter(Boolean).join(" "),
        email: l.email,
        demoEndsAt: l.ends_at,
        status: !l.ends_at ? "none" : new Date(l.ends_at) > new Date() ? "active" : "ended",
        started: l.started,
        paid: l.paid,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const demoErrorStatus = (code: string) => (["learner_not_found", "no_demo_licence"].includes(code) ? 404 : 409);

orgDemoRouter.post("/upgrade", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "org_admin" || !req.user!.tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    res.json(await upgradeDemoLearners({ tenantId: req.user!.tenantId, actorId: req.user!.id, actorRole: "org_admin" }));
  } catch (err) {
    next(err);
  }
});

orgDemoRouter.post("/:userId", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "org_admin" || !req.user!.tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    res.json(await assignDemoLicence({ tenantId: req.user!.tenantId, userId: req.params.userId as string, actorId: req.user!.id }));
  } catch (err) {
    if (err instanceof DemoError) return res.status(demoErrorStatus(err.message)).json({ error: err.message });
    next(err);
  }
});

orgDemoRouter.delete("/:userId", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "org_admin" || !req.user!.tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await reclaimDemoLicence({ tenantId: req.user!.tenantId, userId: req.params.userId as string, actorId: req.user!.id });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof DemoError) return res.status(demoErrorStatus(err.message)).json({ error: err.message });
    next(err);
  }
});

// Demo to paid (stage 9): give a paid licence of the order's length to each
// demo learner who has none, oldest demo first, while the organisation has
// Channel Partner order licences free. They keep their history; their demo ends.
export async function demoLearnersToUpgrade(tenantId: string) {
  const r = await pool.query(
    `SELECT DISTINCT ON (e.user_id) e.user_id, e.starts_at FROM entitlements e JOIN users u ON u.id = e.user_id AND u.deleted_at IS NULL AND u.tenant_id = $1
     WHERE e.source = 'partner_demo' AND e.revoked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM license_assignments a WHERE a.user_id = e.user_id AND a.reclaimed_at IS NULL AND a.ends_at > now())
     ORDER BY e.user_id, e.starts_at`,
    [tenantId],
  );
  return r.rows.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)).map((x) => x.user_id as string);
}

// Learner-months free in the organisation's Channel Partner order lots, and the
// licence length of the order with the most free.
export async function partnerOrderPool(tenantId: string) {
  const r = await pool.query(
    `SELECT o.licence_months, sum(p.quantity - (SELECT count(*) FROM license_assignments a WHERE a.purchase_id = p.id AND a.reclaimed_at IS NULL))::int AS free
     FROM license_purchases p JOIN partner_orders o ON o.id = p.partner_order_id
     WHERE p.tenant_id = $1 AND p.pool_expires_at > now() GROUP BY o.licence_months ORDER BY free DESC`,
    [tenantId],
  );
  const free = r.rows.reduce((n, x) => n + x.free, 0);
  return { freeMonths: free, licenceMonths: (r.rows[0]?.licence_months as number) ?? 3 };
}

export async function upgradeDemoLearners(args: { tenantId: string; actorId: string; actorRole: "org_admin" | "system" }): Promise<{ upgraded: number; left: number }> {
  const { assignMonths } = await import("../licenses/service.js");
  const ids = await demoLearnersToUpgrade(args.tenantId);
  let upgraded = 0;
  for (const userId of ids) {
    const p = await partnerOrderPool(args.tenantId);
    if (p.freeMonths < p.licenceMonths) break;
    try {
      await assignMonths({ tenantId: args.tenantId, userId, months: p.licenceMonths, actorId: args.actorId, actorRole: args.actorRole });
    } catch {
      break; // pool used up (or reserved for batches / managers)
    }
    await pool.query(`UPDATE entitlements SET ends_at = least(ends_at, now()) WHERE user_id = $1 AND source = 'partner_demo' AND revoked_at IS NULL`, [userId]);
    upgraded++;
  }
  if (upgraded) await recordAudit({ tenantId: args.tenantId, actorId: args.actorId, action: "demo_licence.upgraded", targetType: "tenant", targetId: args.tenantId, details: { learners: upgraded } });
  return { upgraded, left: ids.length - upgraded };
}
