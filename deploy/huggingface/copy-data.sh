#!/usr/bin/env bash
# One-time copy of the local database and files to Supabase.
# Usage: deploy/huggingface/copy-data.sh path/to/cloud.env
# cloud.env sets SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY and
# FILE_MIRROR_BUCKET. The local database comes from backend/.env.
# The Supabase database must be empty: this doesn't drop anything first.
set -euo pipefail
# Reads KEY=VALUE lines (values may contain spaces) without running them as shell.
load_env() {
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    local v="${BASH_REMATCH[2]}"
    v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    export "${BASH_REMATCH[1]}=$v"
  done < "$1"
}
cd "$(dirname "$0")/../../backend"
load_env ./.env; load_env "$1"

echo "Copying the database…"
pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges --quote-all-identifiers \
  | grep -vE '^(CREATE SCHEMA "?public"?;|COMMENT ON SCHEMA "?public"?)' \
  | psql "$SUPABASE_DB_URL" -q -v ON_ERROR_STOP=1 >/dev/null
psql "$SUPABASE_DB_URL" -Atc "SELECT 'users: ' || count(*) FROM users; SELECT 'migrations: ' || count(*) FROM pgmigrations;"

echo "Copying uploads/ and private/ to the ${FILE_MIRROR_BUCKET} bucket…"
npx tsx -e 'import("./src/storage/mirror.ts").then(async (m) => console.log("uploaded", await m.pushAllFiles(), "files"))'
