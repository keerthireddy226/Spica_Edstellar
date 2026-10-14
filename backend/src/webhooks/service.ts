import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { pool } from "../db.js";
import { enqueue } from "../queue/queue.js";
import { notify, orgAdminIds } from "../notifications/service.js";

export const WEBHOOK_EVENTS = [
  "learner.created",
  "learner.deactivated",
  "learner.reactivated",
  "learner.deleted",
  "learner.moved",
  "license.assigned",
  "license.reclaimed",
  "batch.completed",
  "certificate.issued",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "ping";

export const DELIVERY_MAX_ATTEMPTS = 6;
const DISABLE_AFTER_FAILURES = 20;
const TIMEOUT_MS = 10_000;

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

// Signature the receiver checks: HMAC-SHA256 over "<timestamp>.<body>".
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

// Records one delivery per subscribed webhook and queues it. Never throws:
// a webhook problem must not break the action that triggered it.
export async function emitEvent(tenantId: string | null, event: WebhookEvent, data: Record<string, unknown>, onlyWebhookId?: string) {
  if (!tenantId) return;
  try {
    const hooks = await pool.query(
      `SELECT id FROM webhooks WHERE tenant_id = $1 AND enabled AND ($2::uuid IS NOT NULL AND id = $2 OR $2::uuid IS NULL AND $3 = ANY(events))`,
      [tenantId, onlyWebhookId ?? null, event],
    );
    for (const h of hooks.rows) {
      const d = await pool.query(`INSERT INTO webhook_deliveries (webhook_id, event, payload) VALUES ($1, $2, $3) RETURNING id`, [
        h.id,
        event,
        JSON.stringify(data),
      ]);
      await enqueue("webhook.deliver", { deliveryId: d.rows[0].id }, { maxAttempts: DELIVERY_MAX_ATTEMPTS });
    }
  } catch (err) {
    console.error(`webhook emit ${event} failed:`, err);
  }
}

// ---- SSRF guard: never call into private networks ----

const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["100.64.0.0", 10],
  ["0.0.0.0", 8],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["::", 128],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv6");

export function webhookUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Not a valid URL.";
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && process.env.NODE_ENV !== "production")) return "Use an https:// URL.";
  if (u.username || u.password) return "Don't put credentials in the URL.";
  return null;
}

async function assertPublicHost(url: URL) {
  if (process.env.WEBHOOK_ALLOW_PRIVATE === "true") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const a of addrs) {
    if (PRIVATE.check(a.address, a.family === 6 ? "ipv6" : "ipv4")) throw new Error(`refusing to call private address ${a.address}`);
  }
}

// Queue handler. Throws on failure so the queue retries with backoff; after
// the last attempt the failure counts toward disabling the webhook.
export async function deliverWebhook(deliveryId: string, attempt: number) {
  const d = (
    await pool.query(
      `SELECT d.id, d.event, d.payload, d.created_at, d.status, w.id AS webhook_id, w.url, w.secret, w.enabled, w.tenant_id
       FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = $1`,
      [deliveryId],
    )
  ).rows[0];
  if (!d || d.status === "delivered") return;
  if (!d.enabled) {
    await pool.query(`UPDATE webhook_deliveries SET status = 'failed', last_error = 'webhook disabled' WHERE id = $1`, [deliveryId]);
    return;
  }
  const body = JSON.stringify({ id: d.id, event: d.event, createdAt: d.created_at, data: d.payload });
  const ts = Math.floor(Date.now() / 1000);
  let code: number | null = null;
  let error: string | null = null;
  try {
    const url = new URL(d.url);
    await assertPublicHost(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Spica-Webhooks/1.0",
          "X-Spica-Event": d.event,
          "X-Spica-Delivery": d.id,
          "X-Spica-Signature": `t=${ts},v1=${signPayload(d.secret, ts, body)}`,
        },
        body,
      });
      code = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (!error) {
    await pool.query(`UPDATE webhook_deliveries SET status = 'delivered', attempts = $2, response_code = $3, delivered_at = now(), last_error = NULL WHERE id = $1`, [
      deliveryId,
      attempt,
      code,
    ]);
    await pool.query(`UPDATE webhooks SET consecutive_failures = 0 WHERE id = $1`, [d.webhook_id]);
    return;
  }
  const final = attempt >= DELIVERY_MAX_ATTEMPTS;
  await pool.query(`UPDATE webhook_deliveries SET status = $2, attempts = $3, response_code = $4, last_error = $5 WHERE id = $1`, [
    deliveryId,
    final ? "failed" : "pending",
    attempt,
    code,
    error.slice(0, 500),
  ]);
  if (final) {
    const w = (
      await pool.query(`UPDATE webhooks SET consecutive_failures = consecutive_failures + 1 WHERE id = $1 RETURNING consecutive_failures, url`, [d.webhook_id])
    ).rows[0];
    if (w && w.consecutive_failures >= DISABLE_AFTER_FAILURES) {
      await pool.query(`UPDATE webhooks SET enabled = false, disabled_reason = $2 WHERE id = $1`, [d.webhook_id, `${DISABLE_AFTER_FAILURES} deliveries in a row failed`]);
      for (const id of await orgAdminIds(d.tenant_id)) {
        await notify({
          userId: id,
          kind: "webhook_disabled",
          title: "A webhook was turned off",
          body: `${w.url} failed ${DISABLE_AFTER_FAILURES} times in a row, so Spica stopped sending to it. Fix it and turn it back on in Settings → Developers.`,
          link: "/orgadmin/developers",
          email: true,
        });
      }
    }
    return;
  }
  throw new Error(error);
}
