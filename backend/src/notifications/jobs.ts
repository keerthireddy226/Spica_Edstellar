import { pool } from "../db.js";
import { computeStreakDays } from "../gamification/stats.js";
import { GRACE_DAYS, learnerAccessMap, managerPools, poolSummary } from "../licenses/service.js";
import { learnerEngagement } from "./engagement.js";
import { batchManagerIds, notify, orgAdminIds } from "./service.js";
import { endPilot } from "../plans/service.js";

const DAY = 86400000;
const JOB_LOCK_ID = 917_004; // arbitrary, unique to this job runner

function shortDate(d: Date | string | number): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function fullName(r: { first_name: string | null; last_name: string | null; email: string }): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email;
}

// ---- 1. License alerts: learners, Org Admins, pool ----

export async function runLicenseAlerts(): Promise<number> {
  let sent = 0;
  const learners = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.tenant_id, u.batch_id, t.type AS tenant_type
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.role = 'learner' AND u.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM license_assignments a WHERE a.user_id = u.id AND a.reclaimed_at IS NULL)`,
  );
  const access = await learnerAccessMap(learners.rows.map((r) => r.id));
  const now = Date.now();

  for (const l of learners.rows) {
    const a = access.get(l.id)!;
    if (!a.accessEndsAt) continue;
    const ends = new Date(a.accessEndsAt).getTime();
    const endKey = a.accessEndsAt.slice(0, 10);
    const individual = l.tenant_type !== "cohort";
    const action = individual ? "Renew from Plans to keep going." : "Ask your organization's admin or manager to extend it.";
    const link = individual ? "/plans" : "/profile";

    let stage: "7d" | "3d" | "ended" | "grace_ended" | null = null;
    if (ends > now && ends - now <= 3 * DAY) stage = "3d";
    else if (ends > now && ends - now <= 7 * DAY) stage = "7d";
    else if (ends <= now && now < ends + GRACE_DAYS * DAY) stage = "ended";
    else if (now >= ends + GRACE_DAYS * DAY && now < ends + (GRACE_DAYS + 2) * DAY) stage = "grace_ended";
    if (!stage) continue;

    const copy = {
      "7d": { kind: "license_expiring", title: `Your access ends on ${shortDate(ends)}`, body: `You have about a week of access left. ${action}` },
      "3d": { kind: "license_expiring", title: `Your access ends in ${Math.max(1, Math.ceil((ends - now) / DAY))} days`, body: `Your access ends on ${shortDate(ends)}. ${action}` },
      ended: {
        kind: "license_ended",
        title: "Your access has ended",
        body: `Your access ended on ${shortDate(ends)}. You can keep practising until ${shortDate(ends + GRACE_DAYS * DAY)}. ${action}`,
      },
      grace_ended: {
        kind: "license_grace_ended",
        title: "Practice is now locked",
        body: `Your grace period ended. Your progress and reports are saved. ${action}`,
      },
    }[stage];
    const r = await notify({
      userId: l.id,
      kind: copy.kind as "license_expiring" | "license_ended" | "license_grace_ended",
      title: copy.title,
      body: copy.body,
      link,
      dedupeKey: `lic:${l.id}:${endKey}:${stage}`,
      email: true,
    });
    if (r) sent++;
  }

  // Daily digest per organization: who's ending soon, flagging the ones who
  // are actively practising (worth extending) vs. the ones who've gone quiet.
  const orgs = await pool.query(`SELECT id, name FROM tenants WHERE type = 'cohort' AND deactivated_at IS NULL`);
  for (const org of orgs.rows) {
    const rows = await learnerEngagement({ tenantId: org.id });
    const ending = rows.filter((r) => r.license.status === "active" && r.license.accessEndsAt && new Date(r.license.accessEndsAt).getTime() - now <= 7 * DAY);
    const lapsed = rows.filter((r) => r.license.status === "grace");
    if (ending.length || lapsed.length) {
      const active = ending.filter((r) => r.status === "on_track" || r.status === "slow");
      const quiet = ending.filter((r) => r.status === "not_started" || r.status === "inactive");
      const name = (r: (typeof rows)[number]) => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email;
      const lines = [
        ending.length ? `${ending.length} learner${ending.length === 1 ? "'s" : "s'"} access ends within 7 days.` : "",
        active.length ? `Still practising — worth extending: ${active.slice(0, 8).map(name).join(", ")}${active.length > 8 ? "…" : ""}.` : "",
        quiet.length ? `Not practising lately: ${quiet.slice(0, 8).map(name).join(", ")}${quiet.length > 8 ? "…" : ""}.` : "",
        lapsed.length ? `${lapsed.length} in their 3-day grace period now.` : "",
      ].filter(Boolean);
      for (const adminId of await orgAdminIds(org.id)) {
        if (
          await notify({
            userId: adminId,
            kind: "org_license_digest",
            title: `${ending.length + lapsed.length} learner license${ending.length + lapsed.length === 1 ? "" : "s"} need attention`,
            body: lines.join(" "),
            link: "/orgadmin/licenses",
            dedupeKey: `orgdigest:${org.id}:${dayKey()}`,
            email: true,
          })
        )
          sent++;
      }
    }

    // Pool: unassigned licenses about to expire. Each purchase lot gets its own
    // warnings at 60, 30 and 7 days, so a second lot expiring later is never
    // hidden behind the first.
    const summary = await poolSummary(org.id);
    const lots = await pool.query(
      `SELECT p.id, p.pool_expires_at, p.quantity - count(a.id) FILTER (WHERE a.reclaimed_at IS NULL)::int AS unused
       FROM license_purchases p LEFT JOIN license_assignments a ON a.purchase_id = p.id
       WHERE p.tenant_id = $1 AND p.pool_expires_at > now() AND p.pool_expires_at < now() + interval '60 days'
       GROUP BY p.id
       HAVING p.quantity - count(a.id) FILTER (WHERE a.reclaimed_at IS NULL) > 0`,
      [org.id],
    );
    for (const lot of lots.rows) {
      const days = Math.ceil((new Date(lot.pool_expires_at).getTime() - now) / DAY);
      const bucket = days <= 7 ? "7" : days <= 30 ? "30" : "60";
      for (const adminId of await orgAdminIds(org.id)) {
        if (
          await notify({
            userId: adminId,
            kind: "pool_expiring",
            title: `${lot.unused} unassigned license${lot.unused === 1 ? "" : "s"} expire ${shortDate(lot.pool_expires_at)} (${days} day${days === 1 ? "" : "s"})`,
            body: "Unassigned licenses expire 12 months after purchase and can't be used after that. Assign them to learners before then.",
            link: "/orgadmin/licenses",
            dedupeKey: `poolexp:${lot.id}:${bucket}`,
            email: true,
          })
        )
          sent++;
      }
    }
    // Running low: fewer licenses left than learners who will need one soon.
    const needSoon = summary.expiringSoonLearners + summary.unlicensedLearners;
    if (summary.available > 0 && needSoon > summary.available) {
      const week = dayKey(new Date(now - new Date().getUTCDay() * DAY));
      for (const adminId of await orgAdminIds(org.id)) {
        if (
          await notify({
            userId: adminId,
            kind: "pool_low",
            title: `Only ${summary.available} license${summary.available === 1 ? "" : "s"} left`,
            body: `${needSoon} learner(s) have no license or will need an extension soon. Buy licenses so nobody loses access.`,
            link: "/orgadmin/licenses",
            dedupeKey: `poolrunlow:${org.id}:${week}`,
            email: true,
          })
        )
          sent++;
      }
    }
    if (summary.available === 0 && summary.unlicensedLearners + summary.expiredLearners > 0) {
      const week = dayKey(new Date(now - (new Date().getUTCDay() * DAY)));
      for (const adminId of await orgAdminIds(org.id)) {
        if (
          await notify({
            userId: adminId,
            kind: "pool_low",
            title: "Your license pool is empty",
            body: `${summary.unlicensedLearners + summary.expiredLearners} learner(s) have no active access and there are no licenses left to assign.`,
            link: "/orgadmin/licenses",
            dedupeKey: `poollow:${org.id}:${week}`,
            email: true,
          })
        )
          sent++;
      }
    }
  }
  return sent;
}

// ---- 2. Automatic nudges for batches that turned them on ----

export async function runAutoReminders(): Promise<number> {
  let sent = 0;
  const batches = await pool.query(`SELECT id, tenant_id, name FROM batches WHERE auto_reminders`);
  const now = Date.now();
  for (const b of batches.rows) {
    const rows = await learnerEngagement({ tenantId: b.tenant_id, batchIds: [b.id] });
    for (const r of rows) {
      if (r.license.status !== "active" && r.license.status !== "grace") continue;
      let key: string | null = null;
      let title = "";
      let body = "";
      if (r.status === "not_started") {
        const created = (await pool.query(`SELECT created_at FROM users WHERE id = $1`, [r.id])).rows[0].created_at;
        const age = Math.floor((now - new Date(created).getTime()) / DAY);
        const step = age >= 7 ? 7 : age >= 3 ? 3 : null;
        if (!step) continue;
        key = `auto:${r.id}:notstarted:${step}`;
        title = "Your English practice is ready";
        body = "Your access is active. Start with the placement test — it takes about 10 minutes and builds your personal plan.";
      } else if (r.status === "inactive" && r.lastActiveAt) {
        const idle = Math.floor((now - new Date(r.lastActiveAt).getTime()) / DAY);
        const step = idle >= 14 ? 14 : idle >= 7 ? 7 : null;
        if (!step) continue;
        key = `auto:${r.id}:inactive:${r.lastActiveAt.toString().slice(0, 10)}:${step}`;
        title = `It's been ${idle} days since your last practice`;
        body = `${r.targetCefr ? `Your batch goal is ${r.targetCefr}. ` : ""}A 15-minute session today keeps you on track.`;
      }
      if (!key) continue;
      if (await notify({ userId: r.id, kind: "auto_reminder", title, body, link: "/dashboard", dedupeKey: key, email: true, batchId: b.id })) sent++;
    }
  }
  return sent;
}

// ---- 3. Escalation: nudged twice, still not going → Org Admin + Managers ----

export async function runEscalations(): Promise<number> {
  let sent = 0;
  const orgs = await pool.query(`SELECT id FROM tenants WHERE type = 'cohort' AND deactivated_at IS NULL`);
  for (const org of orgs.rows) {
    const stuck = (await learnerEngagement({ tenantId: org.id })).filter((r) => r.needsAttention);
    if (stuck.length === 0) continue;
    const names = stuck.slice(0, 10).map((r) => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email);
    const body = `Reminded twice or more and still ${stuck.length === 1 ? "hasn't" : "haven't"} started or come back: ${names.join(", ")}${stuck.length > 10 ? "…" : ""}.`;
    const recipients = new Set(await orgAdminIds(org.id));
    for (const batchId of new Set(stuck.map((r) => r.batchId).filter(Boolean) as string[])) {
      for (const m of await batchManagerIds(batchId)) recipients.add(m);
    }
    for (const userId of recipients) {
      const role = (await pool.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0]?.role;
      if (
        await notify({
          userId,
          kind: "escalation",
          title: `${stuck.length} learner${stuck.length === 1 ? " needs" : "s need"} a personal follow-up`,
          body,
          link: role === "manager" ? "/manager/learners" : "/orgadmin/learners",
          dedupeKey: `escalation:${userId}:${dayKey()}`,
          email: false,
        })
      )
        sent++;
    }
  }
  return sent;
}

// ---- 4. Learner's own daily practice reminder + streak-at-risk ----

function localParts(timeZone: string, at = new Date()) {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday, tz };
}

function localDateOf(iso: string | Date, tz: string): string {
  return localParts(tz, new Date(iso)).date;
}

export async function runDailyReminders(at = new Date()): Promise<number> {
  let sent = 0;
  const prefs = await pool.query(
    `SELECT rp.*, rp.last_sent_on::text AS last_sent_text, rp.local_time::text AS local_time_text, u.email, u.first_name, u.last_name FROM reminder_preferences rp JOIN users u ON u.id = rp.user_id
     WHERE rp.enabled AND u.role = 'learner' AND u.deleted_at IS NULL`,
  );
  if (prefs.rowCount === 0) return 0;
  const access = await learnerAccessMap(prefs.rows.map((r) => r.user_id));
  const kinds = await pool.query(
    `SELECT u.id, t.type FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ANY($1::uuid[])`,
    [prefs.rows.map((r) => r.user_id)],
  );
  const tenantType = new Map(kinds.rows.map((r) => [r.id, r.type]));

  for (const p of prefs.rows) {
    const local = localParts(p.timezone, at);
    // Org learners with no live license can't practise — reminding them would just frustrate.
    const a = access.get(p.user_id)!;
    if (tenantType.get(p.user_id) === "cohort" && a.status !== "active" && a.status !== "grace") continue;

    const sessions = await pool.query(
      `SELECT completed_at FROM sessions WHERE user_id = $1 AND completed_at IS NOT NULL AND completed_at > now() - interval '120 days'`,
      [p.user_id],
    );
    const days = sessions.rows.map((s) => localDateOf(s.completed_at, local.tz));
    const practisedToday = days.includes(local.date);
    const streak = computeStreakDays(days);

    const [hh, mm] = String(p.local_time_text).split(":").map(Number);
    const target = hh * 60 + mm;
    const inWindow = local.minutes >= target && local.minutes < target + 15;
    if (inWindow && p.days.includes(local.weekday) && p.last_sent_text !== local.date && !practisedToday) {
      // Did they practise since the last reminder? If not, it was ignored.
      const ignoredLast = p.last_sent_text ? !days.some((d) => d > p.last_sent_text) : false;
      const ignored = ignoredLast ? p.consecutive_ignored + 1 : 0;
      // After a week of ignored reminders, back off to every other day.
      const backOff = ignored >= 7 && new Date(local.date).getUTCDate() % 2 === 1;
      if (!backOff) {
        const r = await notify({
          userId: p.user_id,
          kind: "daily_reminder",
          title: streak > 0 ? `🔥 Day ${streak + 1} — keep your streak going` : "Time for today's English practice",
          body: streak > 0 ? `You're on a ${streak}-day streak. 15 minutes today keeps it alive.` : "A short session today is all it takes to build the habit.",
          link: "/roadmap",
          dedupeKey: `daily:${p.user_id}:${local.date}`,
          email: true,
          unsubscribable: true,
        });
        if (r) sent++;
      }
      await pool.query(`UPDATE reminder_preferences SET last_sent_on = $2, consecutive_ignored = $3 WHERE user_id = $1`, [p.user_id, local.date, ignored]);
    }

    // Streak at risk: 2 hours before local midnight.
    const atRisk = p.streak_alert && streak >= 3 && !practisedToday && local.minutes >= 22 * 60 && local.minutes < 22 * 60 + 15;
    if (atRisk) {
      const r = await notify({
        userId: p.user_id,
        kind: "streak_alert",
        title: `Your ${streak}-day streak ends tonight`,
        body: "Do one quick session before midnight to keep it.",
        link: "/roadmap",
        dedupeKey: `streak:${p.user_id}:${local.date}`,
        email: true,
        unsubscribable: true,
      });
      if (r) sent++;
    }
  }
  return sent;
}

// ---- 5. Pilots: a heads-up before the free licenses lapse, then close it ----

export async function runPilotAlerts(): Promise<number> {
  let sent = 0;
  const pilots = await pool.query(
    `SELECT id, pilot_ends_at FROM tenants WHERE type = 'cohort' AND deactivated_at IS NULL AND pilot_ends_at IS NOT NULL
       AND pilot_ends_at < now() + interval '7 days'`,
  );
  const now = Date.now();
  for (const t of pilots.rows) {
    const ends = new Date(t.pilot_ends_at).getTime();
    const endKey = dayKey(new Date(ends));
    const stage = ends <= now ? "ended" : ends - now <= 2 * DAY ? "2d" : "7d";
    const copy =
      stage === "ended"
        ? { title: "Your pilot has ended", body: "The pilot licenses have lapsed. Choose a plan to keep your learners practising." }
        : { title: `Your pilot ends on ${shortDate(ends)}`, body: "Buy licenses before then so your learners keep their access." };
    for (const id of await orgAdminIds(t.id)) {
      const r = await notify({ userId: id, kind: "pilot", ...copy, link: "/orgadmin/plan", dedupeKey: `pilot:${t.id}:${endKey}:${stage}`, email: true });
      if (r) sent++;
    }
    if (stage === "ended") await endPilot({ tenantId: t.id, actorId: null, note: "Pilot period ended" });
  }
  return sent;
}

// ---- 6. Managers: a daily digest of their batches, and their pool running out ----

export async function runManagerAlerts(): Promise<number> {
  let sent = 0;
  const managers = await pool.query(
    `SELECT u.id, u.tenant_id, coalesce(p.daily_digest, true) AS digest, coalesce(p.pool_alerts, true) AS pool_alerts
     FROM users u JOIN tenants t ON t.id = u.tenant_id LEFT JOIN user_notification_prefs p ON p.user_id = u.id
     WHERE u.role = 'manager' AND u.deleted_at IS NULL AND t.deactivated_at IS NULL`,
  );
  const now = Date.now();
  const today = dayKey();
  for (const m of managers.rows) {
    const batchIds = (await pool.query(`SELECT batch_id FROM batch_managers bm JOIN batches b ON b.id = bm.batch_id WHERE bm.user_id = $1 AND b.status = 'active'`, [m.id])).rows.map((r) => r.batch_id);
    if (batchIds.length === 0) continue;
    const learners = await learnerEngagement({ tenantId: m.tenant_id, batchIds });
    const name = (r: (typeof learners)[number]) => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email;

    if (m.digest) {
      const ending = learners.filter((l) => l.license.status === "active" && l.license.accessEndsAt && new Date(l.license.accessEndsAt).getTime() - now <= 7 * DAY);
      const grace = learners.filter((l) => l.license.status === "grace");
      const quiet = learners.filter((l) => l.status === "inactive");
      const notStarted = learners.filter((l) => l.status === "not_started");
      const lines = [
        ending.length ? `Access ends within 7 days: ${ending.slice(0, 8).map(name).join(", ")}${ending.length > 8 ? "…" : ""}.` : "",
        grace.length ? `In their 3-day grace period: ${grace.slice(0, 8).map(name).join(", ")}.` : "",
        quiet.length ? `Stopped practising: ${quiet.slice(0, 8).map(name).join(", ")}${quiet.length > 8 ? "…" : ""}.` : "",
        notStarted.length ? `Haven't started yet: ${notStarted.length}.` : "",
      ].filter(Boolean);
      if (lines.length) {
        const r = await notify({
          userId: m.id,
          kind: "manager_digest",
          title: `${ending.length + grace.length + quiet.length + notStarted.length} learner${ending.length + grace.length + quiet.length + notStarted.length === 1 ? "" : "s"} in your batches need a look`,
          body: lines.join(" "),
          link: "/manager/learners",
          dedupeKey: `mgrdigest:${m.id}:${today}`,
          email: true,
        });
        if (r) sent++;
      }
    }

    if (m.pool_alerts) {
      const pool_ = (await managerPools(m.tenant_id, [m.id]))[0];
      if (pool_ && pool_.allotment !== null) {
        const unlicensed = learners.filter((l) => l.license.status !== "active" && l.license.status !== "grace").length;
        const state = pool_.remaining === 0 ? (unlicensed > 0 ? "empty" : null) : pool_.remaining !== null && pool_.remaining <= 2 ? "low" : null;
        if (state) {
          const week = dayKey(new Date(now - new Date().getUTCDay() * DAY));
          const r = await notify({
            userId: m.id,
            kind: "manager_pool",
            title: state === "empty" ? "Your license pool is empty" : `Only ${pool_.remaining} license${pool_.remaining === 1 ? "" : "s"} left in your pool`,
            body:
              state === "empty"
                ? `${unlicensed} learner(s) in your batches have no active access. Request more licenses from your Org Admin.`
                : "Request more from your Org Admin before you run out.",
            link: "/manager/dashboard",
            dedupeKey: `mgrpool:${m.id}:${state}:${week}`,
            email: true,
          });
          if (r) sent++;
        }
      }
    }
  }
  return sent;
}

// ---- Runner ----

export async function runAllJobs(): Promise<Record<string, number> | null> {
  const client = await pool.connect();
  try {
    const lock = await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [JOB_LOCK_ID]);
    if (!lock.rows[0].ok) return null; // another instance is running them
    try {
      return {
        daily: await runDailyReminders(),
        license: await runLicenseAlerts(),
        auto: await runAutoReminders(),
        escalation: await runEscalations(),
        pilot: await runPilotAlerts(),
        managers: await runManagerAlerts(),
      };
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [JOB_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}
