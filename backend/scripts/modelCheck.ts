// Model check set: compare the AI's grades with the saved baseline, or make a
// new baseline with --baseline. See src/quality/modelCheck.ts.
import { pool } from "../src/db.js";
import { makeBaseline, runModelCheck } from "../src/quality/modelCheck.js";

const baseline = process.argv.includes("--baseline");
try {
  if (baseline) {
    const b = await makeBaseline();
    const missing = b.cases.filter((c) => typeof c.baseline !== "number").length;
    console.log(`Baseline saved: ${b.cases.length} answers graded by ${b.model}${missing ? `, ${missing} not graded (run again)` : ""}.`);
  } else {
    const r = await runModelCheck();
    if (!r) console.log("No baseline yet: run with --baseline first.");
    else {
      console.log(JSON.stringify(r, null, 1));
      console.log(r.drift ? "DRIFT: scores have moved beyond the limits." : "OK: scores match the baseline within the limits.");
    }
  }
} finally {
  await pool.end();
}
