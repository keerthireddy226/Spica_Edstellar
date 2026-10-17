#!/usr/bin/env bash
# Creates (first time) or updates the Hugging Face Space that runs the backend,
# and points it at the commit currently on GitHub main.
# Usage: deploy/huggingface/deploy.sh path/to/cloud.env
# cloud.env sets HF_TOKEN, HF_SPACE (user/space-name), GITHUB_TOKEN,
# SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY, FILE_MIRROR_BUCKET and
# FRONTEND_URL. The AI and email keys are taken from backend/.env.
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
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
load_env "$root/backend/.env"; load_env "$1"
api=https://huggingface.co/api
auth=(-H "Authorization: Bearer $HF_TOKEN")

# The Space (a "already exists" answer is fine).
curl -s "${auth[@]}" -H "Content-Type: application/json" -X POST "$api/repos/create" \
  -d "{\"type\":\"space\",\"name\":\"${HF_SPACE#*/}\",\"sdk\":\"docker\",\"private\":false}" >/dev/null || true

# Secrets: build time (GITHUB_TOKEN) and run time (everything else).
secret() {
  curl -sf "${auth[@]}" -H "Content-Type: application/json" -X POST "$api/spaces/$HF_SPACE/secrets" \
    -d "$(node -e 'console.log(JSON.stringify({ key: process.argv[1], value: process.argv[2] }))' "$1" "$2")" >/dev/null
}
secret GITHUB_TOKEN "$GITHUB_TOKEN"
secret DATABASE_URL "${SUPABASE_DB_URL}?uselibpqcompat=true&sslmode=require"
secret SUPABASE_URL "$SUPABASE_URL"
secret SUPABASE_SERVICE_KEY "$SUPABASE_SERVICE_KEY"
secret FILE_MIRROR_BUCKET "$FILE_MIRROR_BUCKET"
secret FRONTEND_URL "$FRONTEND_URL"
for k in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM GEMINI_API_KEY ANTHROPIC_API_KEY GOOGLE_TTS_API_KEY; do
  [ -n "${!k:-}" ] && secret "$k" "${!k}"
done

# The Space repo: Dockerfile, README, models (LFS) and the commit to build.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone -q "https://user:${HF_TOKEN}@huggingface.co/spaces/${HF_SPACE}" "$work/space"
cd "$work/space"
git lfs install --local >/dev/null
git lfs track "*.onnx" "*.gz" >/dev/null
cp "$here/Dockerfile" "$here/README.md" .
mkdir -p models && cp "$root"/backend/models/*.onnx "$root"/backend/models/*.traineddata.gz models/
git -C "$root" fetch -q origin main
git -C "$root" rev-parse origin/main > REVISION
git add -A
if git diff --cached --quiet; then echo "Nothing changed."; exit 0; fi
git -c user.name="Spica deploy" -c user.email="deploy@spica.local" commit -qm "Deploy $(cut -c1-7 REVISION)"
git push -q origin HEAD:main
echo "Pushed. The Space rebuilds: https://huggingface.co/spaces/${HF_SPACE}"
echo "Backend address: https://$(echo "$HF_SPACE" | tr '/_.' '---' | tr 'A-Z' 'a-z').hf.space"
