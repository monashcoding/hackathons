#!/bin/sh
# Container start: apply DB migrations, then boot the server. Compose waits for
# the db healthcheck before starting us (depends_on: service_healthy), so the
# database is reachable by the time we run. Migrations are idempotent — drizzle
# tracks applied ones — so this is safe on every restart.
set -e

echo "[entrypoint] running migrations…"
npm run db:migrate

# Staging-only: auto-populate demo content on boot so the preview site isn't
# blank. Gated behind ALLOW_SEED=1 (set only on the staging service) — the seed
# script itself also refuses to run in production without it, so real production
# is never touched. Idempotent (upserts), so re-seeding every deploy is fine.
if [ "$ALLOW_SEED" = "1" ]; then
  echo "[entrypoint] ALLOW_SEED=1 → seeding demo content…"
  npm run db:seed
fi

echo "[entrypoint] starting server…"
exec npm start
