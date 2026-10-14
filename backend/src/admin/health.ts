import { pool } from "../db.js";

export interface OrgHealth {
  tenantId: string;
  score: number; // 0..100
  band: "healthy" | "watch" | "at_risk";
  flags: string[];
  learners: number;
  active7: number;
  licenseUtilization: number | null; // 0..1 of licenses bought that are assigned
  orgAdminLastLoginAt: string | null;
}

// A rough "is this account going well?" for Edstellar staff, from signals we
// already have: are learners practising, are licenses being used, is the Org
// Admin around, are invites accepted, is anything about to lapse.
export async function orgHealth(tenantIds: string[]): Promise<Map<string, OrgHealth>> {
  const out = new Map<string, OrgHealth>();
  if (tenantIds.length === 0) return out;
  const r = await pool.query(
    `SELECT t.id, t.contract_end, t.pilot_ends_at,
       (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id AND u.role = 'learner' AND u.deleted_at IS NULL) AS learners,
       (SELECT count(DISTINCT d.user_id)::int FROM learner_activity_daily d JOIN users u ON u.id = d.user_id
          WHERE d.tenant_id = t.id AND u.role = 'learner' AND u.deleted_at IS NULL AND d.sessions > 0 AND d.day > current_date - 7) AS active7,
       (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id AND u.role = 'learner' AND u.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id)) AS never_logged_in,
       (SELECT coalesce(sum(p.quantity), 0)::int FROM license_purchases p WHERE p.tenant_id = t.id AND p.pool_expires_at > now()) AS bought,
       (SELECT count(*)::int FROM license_assignments a JOIN license_purchases p ON p.id = a.purchase_id
          WHERE p.tenant_id = t.id AND p.pool_expires_at > now() AND a.reclaimed_at IS NULL) AS assigned,
       (SELECT coalesce(sum(p.quantity - (SELECT count(*) FROM license_assignments a WHERE a.purchase_id = p.id AND a.reclaimed_at IS NULL)), 0)::int
          FROM license_purchases p WHERE p.tenant_id = t.id AND p.pool_expires_at BETWEEN now() AND now() + interval '30 days') AS expiring_unused,
       (SELECT max(le.created_at) FROM login_events le JOIN users u ON u.id = le.user_id
          WHERE u.tenant_id = t.id AND u.role = 'org_admin' AND u.deleted_at IS NULL) AS org_admin_last_login
     FROM tenants t WHERE t.id = ANY($1::uuid[])`,
    [tenantIds],
  );
  const now = Date.now();
  for (const o of r.rows) {
    const flags: string[] = [];
    let score = 0;
    const activity = o.learners ? o.active7 / o.learners : 0;
    score += Math.round(Math.min(1, activity / 0.6) * 40);
    if (o.learners > 0 && activity < 0.2) flags.push("Few learners practising this week");
    if (o.learners === 0) flags.push("No learners yet");

    const util = o.bought ? o.assigned / o.bought : null;
    score += util === null ? 10 : Math.round(Math.min(1, util / 0.8) * 20);
    if (util !== null && util < 0.3) flags.push("Most licenses unused");
    if (o.expiring_unused > 0) flags.push(`${o.expiring_unused} unused licenses expire within 30 days`);

    const lastLogin = o.org_admin_last_login ? new Date(o.org_admin_last_login).getTime() : null;
    const days = lastLogin ? (now - lastLogin) / 86400000 : Infinity;
    score += days <= 14 ? 20 : days <= 30 ? 10 : 0;
    if (days > 30) flags.push(lastLogin ? "Org Admin hasn't signed in for a month" : "Org Admin has never signed in");

    const pending = o.learners ? o.never_logged_in / o.learners : 0;
    score += Math.round((1 - pending) * 20);
    if (o.learners > 0 && pending > 0.3) flags.push(`${o.never_logged_in} learners haven't accepted their invite`);

    if (o.contract_end) {
      const left = (new Date(o.contract_end).getTime() - now) / 86400000;
      if (left < 0) flags.push("Contract has ended");
      else if (left <= 60) flags.push(`Contract renews in ${Math.ceil(left)} days`);
    }
    if (o.pilot_ends_at) flags.push("On a pilot");

    score = Math.max(0, Math.min(100, score));
    out.set(o.id, {
      tenantId: o.id,
      score,
      band: score >= 70 ? "healthy" : score >= 40 ? "watch" : "at_risk",
      flags,
      learners: o.learners,
      active7: o.active7,
      licenseUtilization: util,
      orgAdminLastLoginAt: o.org_admin_last_login,
    });
  }
  return out;
}
