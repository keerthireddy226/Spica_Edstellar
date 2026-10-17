# Backend on a free Hugging Face Space

The web app stays on Vercel. The backend runs as a Docker Space on Hugging
Face, the database is on Supabase, and files (recordings, question audio,
logos, proctoring media) are mirrored to a private Supabase Storage bucket.
The Space's disk is wiped on every restart, so on start the backend downloads
the files from the bucket before it serves anything (`src/storage/mirror.ts`),
then uploads new and changed files every 15 seconds.

## Files here

- `Dockerfile`, `README.md`: the Space. The Space repo also gets `REVISION`
  (the GitHub commit to build) and `models/` (the face and voice models).
- `copy-data.sh`: one-time copy of the local database and files to Supabase.
- `deploy.sh`: creates or updates the Space and its secrets, and builds the
  commit currently on GitHub `main`.

## cloud.env (keep it outside the repo)

    HF_TOKEN=hf_...                      # Hugging Face token with write access
    HF_SPACE=your-hf-user/spica-backend
    GITHUB_TOKEN=github_pat_...          # read-only access to this repo
    SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
    SUPABASE_URL=https://<ref>.supabase.co
    SUPABASE_SERVICE_KEY=...             # service_role / secret key
    FILE_MIRROR_BUCKET=spica-files
    FRONTEND_URL=https://spica-edstellar-kohl.vercel.app

Use the Supabase **Session pooler** string (the direct one is IPv6 only).

## First time

1. Push the code to GitHub `main`.
2. `deploy/huggingface/copy-data.sh cloud.env` (the Supabase database must be empty).
3. `deploy/huggingface/deploy.sh cloud.env`, then wait for the Space to show "Running".
4. In `frontend/vercel.json`, point `/api` and `/uploads` at
   `https://<hf-user>-<space>.hf.space` and push.

## After each change

Push to GitHub `main`, then run `deploy/huggingface/deploy.sh cloud.env`.
Migrations run when the Space starts.

## Limits of the free plan

- The Space sleeps after 48 hours without visits; the next visit wakes it in
  about 1-2 minutes (plus the file download).
- Supabase pauses a free project after a week without use; resume it in the
  Supabase dashboard.
