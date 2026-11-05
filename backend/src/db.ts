import { Pool } from "pg";

// Connections to Postgres. The default of 10 queues requests once many people
// are in a test at the same time; DB_POOL_MAX raises it (stay under the
// database's own limit: Supabase's session pooler allows about 15 on the free
// plan, its transaction pooler on port 6543 many more). A request waits at most
// 10 s for a free connection instead of hanging.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Without this, an idle client erroring out (e.g. a dropped connection) crashes
// the whole process via an unhandled 'error' event — a known node-postgres gotcha.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err);
});
