# The Spica backend as a Hugging Face Docker Space. The Space repo holds only
# this file, README.md, REVISION (the commit to build) and models/ (the face
# and voice models, via LFS); the code is fetched from the private GitHub repo
# with the GITHUB_TOKEN secret, so it never becomes public.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

ARG REPO=github.com/keerthireddy226/Spica_Edstellar.git
WORKDIR /app
COPY REVISION /tmp/REVISION
RUN --mount=type=secret,id=GITHUB_TOKEN,mode=0444,required=true \
    git init -q . \
 && git remote add origin "https://x-access-token:$(cat /run/secrets/GITHUB_TOKEN)@${REPO}" \
 && GIT_LFS_SKIP_SMUDGE=1 git fetch -q --depth 1 origin "$(cat /tmp/REVISION)" \
 && GIT_LFS_SKIP_SMUDGE=1 git checkout -q FETCH_HEAD \
 && rm -rf .git

# Backend only (the frontend is on Vercel).
RUN npm ci --workspace=backend --include-workspace-root=false \
 && npm run build --workspace=backend

COPY models/ /app/backend/models/

# Spaces run as user 1000; uploads/ and private/ are written at run time.
RUN mkdir -p /app/backend/uploads /app/backend/private && chown -R 1000:1000 /app/backend
USER 1000
WORKDIR /app/backend
ENV NODE_ENV=production PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "npx node-pg-migrate up -m migrations && node dist/index.js"]
