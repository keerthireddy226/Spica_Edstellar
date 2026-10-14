import { pool } from "../db.js";
import { notify, orgAdminIds } from "../notifications/service.js";

// Periodic: contract renewal heads-up at 60, 30 and 7 days, to the account
// manager (or the managing Admin) and the organization's Org Admin.
export async function runContractRenewalAlerts(): Promise<number> {
  const due = await pool.query(
    `SELECT id, name, contract_end, to_char(contract_end, 'YYYY-MM-DD') AS end_key, coalesce(account_manager_id, managed_by) AS owner,
       (contract_end - current_date) AS days_left
     FROM tenants WHERE type = 'cohort' AND deactivated_at IS NULL AND contract_end IS NOT NULL
       AND contract_end >= current_date AND contract_end <= current_date + 60`,
  );
  let sent = 0;
  for (const t of due.rows) {
    const stage = t.days_left <= 7 ? "7" : t.days_left <= 30 ? "30" : "60";
    const end = new Date(t.contract_end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const key = `contract:${t.id}:${t.end_key}:${stage}`;
    if (t.owner) {
      const r = await notify({
        userId: t.owner,
        kind: "contract_renewal",
        title: `${t.name}'s contract ends ${end}`,
        body: `${t.days_left} days left. Time to talk renewal.`,
        link: "/admin/organizations",
        dedupeKey: `${key}:staff`,
        email: true,
      });
      if (r) sent++;
    }
    for (const id of await orgAdminIds(t.id)) {
      const r = await notify({
        userId: id,
        kind: "contract_renewal",
        title: `Your Spica contract ends ${end}`,
        body: "Your Edstellar contact will be in touch about renewing. Licenses already assigned keep working until they end.",
        link: "/orgadmin/plan",
        dedupeKey: `${key}:org`,
        email: true,
      });
      if (r) sent++;
    }
  }
  return sent;
}
