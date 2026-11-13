// Creates a demo organisation for sales (launch plan 8.6): a made-up company
// with learners, batches, a manager, licences, test results, certificates and
// a recruitment job with candidates. Everything is invented; no email is sent,
// no AI is called. Results are summary results (no per-question answers).
//
//   npx tsx scripts/seedDemoOrg.ts            create it (refuses if it exists)
//   npx tsx scripts/seedDemoOrg.ts --remove   delete it and everything in it
//
// The three demo logins share one password, written to DEMO_PASSWORD_FILE
// (default ./demo-org-password.txt) and never printed.
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import bcrypt from "bcrypt";
import { pool } from "../src/db.js";

const ORG = "Northwind Services (Demo)";
const DOMAIN = "northwind-demo.example";
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
type Level = (typeof LEVELS)[number];
const SKILLS = ["speaking", "listening", "reading", "writing"] as const;
const BAND: Record<Level, [number, number]> = { A1: [20, 29], A2: [30, 39], B1: [40, 54], B2: [55, 69], C1: [70, 79], C2: [80, 90] };

// A repeatable random sequence, so every run makes the same demo.
let seed = 20261113;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const clampLevel = (i: number) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const levelOfPercent = (p: number): Level => (p >= 90 ? "C2" : p >= 78 ? "C1" : p >= 62 ? "B2" : p >= 45 ? "B1" : p >= 28 ? "A2" : "A1");
const spicaScore = (l: Level, p: number) => Math.round(BAND[l][0] + ((BAND[l][1] - BAND[l][0]) * Math.min(100, Math.max(0, p))) / 100);

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya", "Vikram", "Isha", "Arjun", "Priya", "Nikhil", "Sneha", "Rahul", "Kavya", "Siddharth", "Pooja", "Aditya", "Neha", "Karthik", "Lakshmi", "Farhan", "Zoya", "Daniel", "Grace", "Tanvi", "Imran", "Riya", "Varun", "Shreya", "Manoj"];
const LAST = ["Sharma", "Iyer", "Menon", "Reddy", "Nair", "Kapoor", "Das", "Pillai", "Rao", "Joshi", "Khan", "Fernandes", "Mehta", "Bose", "Gupta"];

function result(base: number) {
  const skillPercents = Object.fromEntries(SKILLS.map((s) => [s, Math.max(5, Math.min(98, Math.round(base + (rnd() - 0.5) * 24)))])) as Record<string, number>;
  const skillLevels = Object.fromEntries(SKILLS.map((s) => [s, levelOfPercent(skillPercents[s])]));
  const overallPercent = Math.round(SKILLS.reduce((a, s) => a + skillPercents[s], 0) / 4);
  return { cefrLevel: levelOfPercent(overallPercent), scoreBand: null, skillLevels, skillPercents, overallPercent };
}

async function remove() {
  const t = (await pool.query(`SELECT id FROM tenants WHERE name = $1`, [ORG])).rows[0];
  if (!t) return console.log("No demo organisation to remove.");
  const users = (await pool.query(`SELECT id FROM users WHERE tenant_id = $1`, [t.id])).rows.map((r) => r.id);
  // Tables keyed by user or tenant that the demo writes to, removed in a safe order.
  await pool.query(`DELETE FROM recruitment_credit_events WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM recruitment_assessments WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM consent_records WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM recruitment_jobs WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM certificates WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM placements WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM sessions WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM learner_activity_daily WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM progress_stats WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM license_assignments WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM license_purchases WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM batch_managers WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM participant_profiles WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM auth_sessions WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [users]);
  await pool.query(`UPDATE users SET batch_id = NULL WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM batches WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM users WHERE tenant_id = $1`, [t.id]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [t.id]);
  console.log(`Removed ${ORG} and ${users.length} accounts.`);
}

async function create() {
  if ((await pool.query(`SELECT 1 FROM tenants WHERE name = $1`, [ORG])).rowCount) throw new Error(`${ORG} already exists; run with --remove first.`);
  const password = randomBytes(9).toString("base64url");
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = (
      await client.query(
        `INSERT INTO tenants (name, type, category, plan_tier, products, country, industry, legal_name, city, timezone, default_language,
           dpa_accepted_at, dpa_version, expected_learner_count, employee_count_band, training_goal, created_at)
         VALUES ($1, 'cohort', 'company', 'business', '{skills,recruitment}', 'IN', 'Customer service and BPO', 'Northwind Services Pvt Ltd (demo)',
           'Chennai', 'Asia/Kolkata', 'en', now() - interval '60 days', (SELECT dpa_version FROM tenants WHERE dpa_version IS NOT NULL ORDER BY dpa_accepted_at DESC NULLS LAST LIMIT 1),
           120, '201_1000', 'Raise customer-facing staff to B2', now() - interval '75 days') RETURNING id`,
        [ORG],
      )
    ).rows[0].id;
    const user = async (role: string, email: string, first: string, last: string, extra: Record<string, unknown> = {}) =>
      (
        await client.query(
          `INSERT INTO users (tenant_id, role, email, password_hash, email_verified, first_name, last_name, job_title, department, employee_id, created_at, terms_accepted_at)
           VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, $10, now()) RETURNING id`,
          [tenantId, role, email, hash, first, last, extra.job ?? null, extra.dept ?? null, extra.emp ?? null, extra.created ?? daysAgo(70)],
        )
      ).rows[0].id as string;
    const admin = await user("org_admin", `demo.admin@${DOMAIN}`, "Anita", "Kulkarni (demo)", { job: "L&D Head" });
    const manager = await user("manager", `demo.manager@${DOMAIN}`, "Suresh", "Balan (demo)", { job: "Training Manager" });
    const recruiter = await user("recruiter", `demo.recruiter@${DOMAIN}`, "Fatima", "Sheikh (demo)", { job: "Talent Acquisition" });

    const batchDefs = [
      { name: "Customer Support — Chennai", dept: "Customer Support", start: 60, target: "B2", base: 52 },
      { name: "Inside Sales — Bengaluru", dept: "Sales", start: 45, target: "B2", base: 58 },
      { name: "New Joiners — November", dept: "Operations", start: 12, target: "B1", base: 40 },
    ];
    const purchase = (
      await client.query(
        `INSERT INTO license_purchases (tenant_id, quantity, unit_price_cents, currency, source, reference, created_by, purchased_at, pool_expires_at)
         VALUES ($1, 90, 59900, 'INR', 'purchase', 'DEMO-PO-1001', $2, now() - interval '62 days', now() + interval '300 days') RETURNING id`,
        [tenantId, admin],
      )
    ).rows[0].id;

    let n = 0;
    let certs = 0;
    for (const b of batchDefs) {
      const batchId = (
        await client.query(
          `INSERT INTO batches (tenant_id, name, created_by, created_at, duration_months, start_date, start_cefr, target_cefr, status, department, location, capacity, default_license_months, auto_reminders)
           VALUES ($1, $2, $3, $4, 3, $5, 'B1', $6, 'active', $7, $8, 15, 3, true) RETURNING id`,
          [tenantId, b.name, admin, daysAgo(b.start + 2), daysAgo(b.start), b.target, b.dept, b.name.split("— ")[1] ?? null],
        )
      ).rows[0].id;
      await client.query(`INSERT INTO batch_managers (batch_id, user_id) VALUES ($1, $2)`, [batchId, manager]);
      for (let i = 0; i < 10; i++) {
        const first = FIRST[n % FIRST.length];
        const last = pick(LAST);
        n++;
        const id = await user("learner", `${first.toLowerCase()}.${last.toLowerCase()}${n}@${DOMAIN}`, first, last, {
          job: pick(["Support Associate", "Senior Associate", "Team Lead", "Sales Executive", "Process Trainer"]),
          dept: b.dept,
          emp: `NW${String(1000 + n)}`,
          created: daysAgo(b.start + 1),
        });
        await client.query(`UPDATE users SET batch_id = $2 WHERE id = $1`, [id, batchId]);
        await client.query(
          `INSERT INTO participant_profiles (user_id, onboarding_complete, goal_level, country, city, job_role, first_language, daily_minutes_preference)
           VALUES ($1, true, $2, 'IN', $3, 'support', $4, 20)`,
          [id, b.target, pick(["Chennai", "Bengaluru", "Hyderabad"]), pick(["Tamil", "Kannada", "Telugu", "Hindi", "Malayalam"])],
        );
        await client.query(
          `INSERT INTO license_assignments (tenant_id, purchase_id, user_id, batch_id, starts_at, ends_at, assigned_by, assigned_at, source)
           VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '3 months', $6, $5::timestamptz, 'batch')`,
          [tenantId, purchase, id, batchId, daysAgo(b.start), admin],
        );
        // Placement at the start, then up to three mock tests, improving.
        const learnerBase = b.base + (rnd() - 0.5) * 20;
        const p = result(learnerBase - 8);
        await client.query(
          `INSERT INTO placements (user_id, taken_at, overall_percent, cefr_level, skill_percents, skill_levels, status) VALUES ($1, $2, $3, $4, $5, $6, 'certified')`,
          [id, daysAgo(b.start - 1), p.overallPercent, p.cefrLevel, JSON.stringify(p.skillPercents), JSON.stringify(p.skillLevels)],
        );
        const mocks = b.start > 30 ? 1 + Math.floor(rnd() * 3) : Math.floor(rnd() * 2);
        let last_ = p;
        for (let m = 0; m < mocks; m++) {
          last_ = result(learnerBase - 4 + m * 5);
          const when = daysAgo(Math.max(1, b.start - 15 - m * 12 - Math.floor(rnd() * 5)));
          await client.query(
            `INSERT INTO sessions (user_id, session_type, mode, delivery_mode, composition, started_at, completed_at, test_code, result)
             VALUES ($1, 'mocktest', 'coach', 'mock', $2, $3::timestamptz - interval '32 minutes', $3::timestamptz, $4, $5)`,
            [id, JSON.stringify({ testTypeId: "fourSkills", demo: true }), when, `DEMO-${n}-${m}`, JSON.stringify(last_)],
          );
        }
        // About a third of the longer batches have taken the final assessment.
        if (b.start > 30 && rnd() < 0.4) {
          const r = result(learnerBase + 6);
          const when = daysAgo(3 + Math.floor(rnd() * 10));
          const sid = (
            await client.query(
              `INSERT INTO sessions (user_id, session_type, mode, delivery_mode, composition, started_at, completed_at, test_code, result)
               VALUES ($1, 'mocktest', 'coach', 'certified', $2, $3::timestamptz - interval '35 minutes', $3::timestamptz, $4, $5) RETURNING id`,
              [id, JSON.stringify({ testTypeId: "fourSkills", demo: true }), when, `DEMO-${n}-F`, JSON.stringify(r)],
            )
          ).rows[0].id;
          const level = r.cefrLevel as Level;
          const skillScores = Object.fromEntries(SKILLS.map((s) => [s, { level: r.skillLevels[s], score: spicaScore(r.skillLevels[s] as Level, r.skillPercents[s]) }]));
          const code = "SPC-DEMO-" + createHash("sha1").update(String(sid)).digest("hex").slice(0, 8).toUpperCase().replace(/(.{4})/, "$1-");
          await client.query(
            `INSERT INTO certificates (code, user_id, tenant_id, batch_id, learner_name, organization_name, batch_name, cefr_level, issued_at, kind, session_id, test_type_id, test_name, spica_score, skill_scores, valid_until, report_public)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'result', $10, 'fourSkills', 'English 4 Skills Essentials', $11, $12, ($9::timestamptz::date + 365), false)`,
            [code, id, tenantId, batchId, `${first} ${last}`, ORG, b.name, level, when, sid, spicaScore(level, r.overallPercent), JSON.stringify(skillScores)],
          );
          certs++;
        }
        // Practice activity over the last 30 days.
        for (let d = 1; d <= 30; d++) {
          if (rnd() < 0.45) continue;
          if (d > b.start) break;
          await client.query(
            `INSERT INTO learner_activity_daily (user_id, day, tenant_id, sessions, attempts, active_ms) VALUES ($1, current_date - $2::int, $3, $4, $5, $6)`,
            [id, d, tenantId, 1 + Math.floor(rnd() * 3), 8 + Math.floor(rnd() * 30), (10 + Math.floor(rnd() * 25)) * 60_000],
          );
        }
        void last_;
      }
    }

    // Recruitment: one job with eight candidates in different states.
    const job = (
      await client.query(
        `INSERT INTO recruitment_jobs (tenant_id, title, department, location, description, test_kind, min_cefr, invite_valid_hours, show_result_to_candidate, created_by, created_at)
         VALUES ($1, 'Customer Support Associate (demo)', 'Customer Support', 'Chennai', 'Voice support for international customers.', 'fourSkills', 'B2', 72, false, $2, now() - interval '20 days') RETURNING id`,
        [tenantId, recruiter],
      )
    ).rows[0].id;
    const cand = [
      ["Ravi", "Kumar", 64, "hired"], ["Asha", "Thomas", 71, "shortlisted"], ["Deepak", "Singh", 47, "rejected"], ["Nisha", "Varma", 58, null],
      ["Joseph", "Mathew", 66, "shortlisted"], ["Sana", "Ali", 39, "rejected"], ["Harini", "Suresh", null, null], ["Mohit", "Jain", null, null],
    ] as const;
    for (const [i, [first, last, base, decision]] of cand.entries()) {
      const cid = (
        await client.query(
          `INSERT INTO users (tenant_id, role, email, password_hash, email_verified, first_name, last_name, created_at) VALUES ($1, 'candidate', $2, $3, true, $4, $5, now() - interval '15 days') RETURNING id`,
          [tenantId, `${first.toLowerCase()}.${last.toLowerCase()}@candidates.${DOMAIN}`, hash, first, last],
        )
      ).rows[0].id;
      const done = base !== null;
      const r = done ? { kind: "mock", ...result(base), meetsMinimum: false } : null;
      if (r) r.meetsMinimum = LEVELS.indexOf(r.cefrLevel as Level) >= LEVELS.indexOf("B2");
      await client.query(
        `INSERT INTO recruitment_assessments (tenant_id, job_id, candidate_id, email, first_name, last_name, token_hash, status, result, decision, decided_by, decided_at,
           invited_by, invited_at, expires_at, started_at, completed_at, confirmed_level, confirmed_by, confirmed_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text, $11::uuid, CASE WHEN $10::text IS NULL THEN NULL ELSE now() - interval '2 days' END,
           $11::uuid, now() - interval '14 days', now() + interval '3 days', $12::timestamptz, $13::timestamptz, $14::text, CASE WHEN $14::text IS NULL THEN NULL ELSE $11::uuid END, CASE WHEN $14::text IS NULL THEN NULL ELSE now() - interval '3 days' END, 'invite')`,
        [
          tenantId, job, cid, `${first.toLowerCase()}.${last.toLowerCase()}@candidates.${DOMAIN}`, first, last,
          createHash("sha256").update(randomBytes(16)).digest("hex"), done ? "completed" : "invited", r ? JSON.stringify(r) : null, decision, recruiter,
          done ? daysAgo(10 - i) : null, done ? new Date(daysAgo(10 - i).getTime() + 31 * 60_000) : null, decision ? r!.cefrLevel : null,
        ],
      );
    }
    // Credits: 60 bought, one used for each invitation.
    await client.query(`INSERT INTO recruitment_credit_events (tenant_id, delta, reason, note, actor_id, created_at) VALUES ($1, 60, 'purchase', 'Demo credits', $2, now() - interval '21 days')`, [tenantId, admin]);
    await client.query(`INSERT INTO recruitment_credit_events (tenant_id, delta, reason, note, actor_id, created_at) VALUES ($1, $2, 'invite', 'Customer Support Associate (demo)', $3, now() - interval '14 days')`, [tenantId, -cand.length, recruiter]);
    await client.query("COMMIT");
    const file = process.env.DEMO_PASSWORD_FILE ?? "demo-org-password.txt";
    writeFileSync(file, `${ORG}\nOrg Admin: demo.admin@${DOMAIN}\nManager: demo.manager@${DOMAIN}\nRecruiter: demo.recruiter@${DOMAIN}\nPassword (all three): ${password}\n`, { mode: 0o600 });
    console.log(`Created ${ORG}: 3 batches, ${n} learners, ${certs} certificates, 1 job with ${cand.length} candidates. Logins and password saved to ${file}.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

(process.argv.includes("--remove") ? remove() : create())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
