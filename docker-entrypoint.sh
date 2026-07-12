#!/bin/sh
# Container start: apply DB migrations, then boot the server. Compose waits for
# the db healthcheck before starting us (depends_on: service_healthy), so the
# database is reachable by the time we run. Migrations are idempotent — drizzle
# tracks applied ones — so this is safe on every restart.
set -e

echo "[entrypoint] running migrations…"
npm run db:migrate

echo "[entrypoint] starting server…"
exec npm start
