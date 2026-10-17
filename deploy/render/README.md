# Backend on Render (free) + Supabase

The web app is on Vercel; `frontend/vercel.json` forwards `/api` and
`/uploads` to `https://spica-backend.onrender.com`.

- **Backend**: Render free web service `spica-backend`, Singapore, built from
  GitHub `main` on every push (`autoDeploy`). Build:
  `npm ci --workspace=backend && npm run build --workspace=backend`.
  Start: migrations, then `node dist/index.js`.
- **Database**: Supabase (Singapore), through the Session pooler.
- **Files**: Render's disk is wiped on every restart, so `uploads/` and
  `private/` are mirrored to the private Supabase Storage bucket `spica-files`
  (`backend/src/storage/mirror.ts`): listed at start, downloaded in the
  background or on demand, and new files uploaded every 15 seconds.
- **Staying awake**: free Render services sleep after 15 minutes without
  requests. A Supabase `pg_cron` job (`keep-spica-backend-awake`) calls
  `/api/health` every 10 minutes, which also keeps the Supabase project from
  pausing. Remove it with `SELECT cron.unschedule('keep-spica-backend-awake');`.

## Setup and changes

`cloud.env` (outside the repo) holds `RENDER_API_KEY`, `SUPABASE_DB_URL`,
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `FILE_MIRROR_BUCKET` and
`FRONTEND_URL`; see `deploy/huggingface/DEPLOY.md` for the format.

- First copy of the local database and files: `deploy/huggingface/copy-data.sh cloud.env`.
- Create the service, or update its environment variables and redeploy:
  `node deploy/render/create-service.mjs cloud.env`.
- Code changes deploy by themselves when pushed to `main`.

The Hugging Face files in `deploy/huggingface` are kept for reference: Docker
Spaces need a paid PRO plan since 2026.
