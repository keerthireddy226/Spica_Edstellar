// Creates the backend's free Render web service (Singapore, builds from GitHub
// main) with its environment variables, or updates the variables if it exists.
// Usage: node deploy/render/create-service.mjs path/to/cloud.env
// cloud.env sets RENDER_API_KEY, SUPABASE_DB_URL, SUPABASE_URL,
// SUPABASE_SERVICE_KEY, FILE_MIRROR_BUCKET and FRONTEND_URL; the AI and email
// keys come from backend/.env.
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const parse = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
      .filter(Boolean)
      .map(([, k, v]) => [k, v.replace(/^(["'])(.*)\1$/, "$2")]),
  );
const env = { ...parse(path.join(root, "backend/.env")), ...parse(process.argv[2]) };
const api = async (method, url, body) => {
  const r = await fetch(`https://api.render.com/v1${url}`, {
    method,
    headers: { Authorization: `Bearer ${env.RENDER_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

const NAME = "spica-backend";
const vars = {
  NODE_VERSION: "22",
  DATABASE_URL: `${env.SUPABASE_DB_URL}?uselibpqcompat=true&sslmode=require`,
  SUPABASE_URL: env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
  FILE_MIRROR_BUCKET: env.FILE_MIRROR_BUCKET,
  FRONTEND_URL: env.FRONTEND_URL,
};
for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_TTS_API_KEY"]) if (env[k]) vars[k] = env[k];
const envVars = Object.entries(vars).map(([key, value]) => ({ key, value }));

const owner = (await api("GET", "/owners?limit=1"))[0].owner;
const existing = (await api("GET", `/services?name=${NAME}&limit=1`))[0]?.service;
if (existing) {
  await api("PUT", `/services/${existing.id}/env-vars`, envVars);
  await api("POST", `/services/${existing.id}/deploys`, {});
  console.log(`Updated ${NAME}: ${existing.serviceDetails.url}`);
} else {
  const r = await api("POST", "/services", {
    type: "web_service",
    name: NAME,
    ownerId: owner.id,
    repo: "https://github.com/keerthireddy226/Spica_Edstellar",
    branch: "main",
    autoDeploy: "yes",
    envVars,
    serviceDetails: {
      runtime: "node",
      plan: "free",
      region: "singapore",
      healthCheckPath: "/api/health",
      envSpecificDetails: {
        buildCommand: "npm ci --workspace=backend && npm run build --workspace=backend",
        // Migrations run on every start; NODE_ENV only here, so the build keeps dev dependencies.
        startCommand: "cd backend && npx node-pg-migrate up -m migrations && NODE_ENV=production node dist/index.js",
      },
    },
  });
  console.log(`Created ${NAME}: ${r.service.serviceDetails.url} (id ${r.service.id})`);
}
