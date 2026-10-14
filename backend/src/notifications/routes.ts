import { z } from "zod";
import { Router, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { REMINDER_COOLDOWN_HOURS, learnerEngagement } from "./engagement.js";
import { runAllJobs } from "./jobs.js";
import { listNotifications, notify, verifyUnsubscribeToken } from "./service.js";

export const notificationsRouter = Router();
export const remindersRouter = Router();

// ---- Bell ----

notificationsRouter.get("/", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json(await listNotifications(req.user!.id));
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/read-all", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    await pool.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.user!.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/:id/read", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    await pool.query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`, [
      String(req.params.id),
      req.user!.id,
    ]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---- Learner's daily practice reminder ----

const prefsSchema = z.object({
  enabled: z.boolean(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(64),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  streakAlert: z.boolean(),
});

notificationsRouter.get("/preferences", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const r = (
      await pool.query(`SELECT enabled, local_time::text AS local_time, timezone, days, streak_alert FROM reminder_preferences WHERE user_id = $1`, [
        req.user!.id,
      ])
    ).rows[0];
    res.json(
      r
        ? { enabled: r.enabled, localTime: r.local_time.slice(0, 5), timezone: r.timezone, days: r.days, streakAlert: r.streak_alert, saved: true }
        : { enabled: false, localTime: "19:00", timezone: null, days: [0, 1, 2, 3, 4, 5, 6], streakAlert: true, saved: false },
    );
  } catch (err) {
    next(err);
  }
});

notificationsRouter.put("/preferences", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = prefsSchema.parse(req.body);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
    } catch {
      return res.status(400).json({ error: "invalid_timezone" });
    }
    await pool.query(
      `INSERT INTO reminder_preferences (user_id, enabled, local_time, timezone, days, streak_alert, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id) DO UPDATE SET enabled = $2, local_time = $3, timezone = $4, days = $5, streak_alert = $6,
         consecutive_ignored = CASE WHEN reminder_preferences.local_time <> $3 THEN 0 ELSE reminder_preferences.consecutive_ignored END,
         updated_at = now()`,
      [req.user!.id, body.enabled, body.localTime, body.timezone, body.days, body.streakAlert],
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// One-click unsubscribe from reminder emails (link in every reminder email).
notificationsRouter.all("/unsubscribe", async (req, res, next) => {
  try {
    const userId = String(req.query.u ?? "");
    const token = String(req.query.t ?? "");
    if (!/^[0-9a-f-]{36}$/.test(userId) || !verifyUnsubscribeToken(userId, token)) {
      return res.status(400).send("This unsubscribe link isn't valid.");
    }
    await pool.query(`UPDATE reminder_preferences SET enabled = false, streak_alert = false, updated_at = now() WHERE user_id = $1`, [userId]);
    res
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title><body style="font-family:system-ui;max-width:420px;margin:80px auto;text-align:center"><h2>You're unsubscribed</h2><p>You won't get practice reminder emails anymore. You can turn them back on any time from your Profile.</p></body>`,
      );
  } catch (err) {
    next(err);
  }
});

// Super Admin: run the scheduled jobs now instead of waiting for the next tick.
notificationsRouter.post("/run-jobs", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "super_admin") return res.status(403).json({ error: "forbidden" });
  try {
    res.json({ result: await runAllJobs() });
  } catch (err) {
    next(err);
  }
});

// ---- Manager / Org Admin: learner engagement + reminders ----

async function reminderScope(req: AuthedRequest, res: Response): Promise<{ tenantId: string; batchIds?: string[] } | null> {
  const user = req.user!;
  if (user.role === "org_admin" && user.tenantId) return { tenantId: user.tenantId };
  if (user.role === "manager" && user.tenantId) {
    const r = await pool.query(`SELECT batch_id FROM batch_managers WHERE user_id = $1`, [user.id]);
    return { tenantId: user.tenantId, batchIds: r.rows.map((x) => x.batch_id) };
  }
  res.status(403).json({ error: "forbidden" });
  return null;
}

remindersRouter.get("/learners", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await reminderScope(req, res);
    if (!scope) return;
    const [learners, batches] = await Promise.all([
      learnerEngagement(scope),
      pool.query(
        `SELECT id, name, auto_reminders FROM batches WHERE tenant_id = $1 ${scope.batchIds ? "AND id = ANY($2::uuid[])" : ""} ORDER BY created_at DESC`,
        scope.batchIds ? [scope.tenantId, scope.batchIds] : [scope.tenantId],
      ),
    ]);
    res.json({
      learners,
      batches: batches.rows.map((b) => ({ id: b.id, name: b.name, autoReminders: b.auto_reminders })),
      cooldownHours: REMINDER_COOLDOWN_HOURS,
    });
  } catch (err) {
    next(err);
  }
});

const sendSchema = z.object({
  learnerIds: z.array(z.string().uuid()).min(1).max(500),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1000),
});

remindersRouter.post("/send", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await reminderScope(req, res);
    if (!scope) return;
    const body = sendSchema.parse(req.body);
    const rows = await learnerEngagement({ ...scope, learnerIds: body.learnerIds });
    const allowed = new Map(rows.map((r) => [r.id, r]));
    const sender = (await pool.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [req.user!.id])).rows[0];
    const senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(" ") || "Your organization";

    const results: { learnerId: string; status: "sent" | "cooldown" | "not_found"; canRemindAt?: string }[] = [];
    for (const id of body.learnerIds) {
      const r = allowed.get(id);
      if (!r) {
        results.push({ learnerId: id, status: "not_found" });
        continue;
      }
      if (r.canRemindAt) {
        results.push({ learnerId: id, status: "cooldown", canRemindAt: r.canRemindAt });
        continue;
      }
      await notify({
        userId: id,
        kind: "manager_reminder",
        title: body.title,
        body: body.message,
        link: "/dashboard",
        email: true,
        emailText: `${body.message}\n\n— ${senderName}`,
        sentBy: req.user!.id,
        batchId: r.batchId,
        meta: { status: r.status },
      });
      results.push({ learnerId: id, status: "sent" });
    }
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

remindersRouter.patch("/batches/:id/auto", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await reminderScope(req, res);
    if (!scope) return;
    const batchId = String(req.params.id);
    if (scope.batchIds && !scope.batchIds.includes(batchId)) return res.status(404).json({ error: "batch_not_found" });
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    const r = await pool.query(`UPDATE batches SET auto_reminders = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id`, [
      body.enabled,
      batchId,
      scope.tenantId,
    ]);
    if (r.rowCount === 0) return res.status(404).json({ error: "batch_not_found" });
    res.json({ enabled: body.enabled });
  } catch (err) {
    next(err);
  }
});
