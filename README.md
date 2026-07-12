# mac-hackathon

MAC's hackathon platform: a public info site (Notion-driven) plus team registration where
**every participant is verified against a real, paid Humanitix ticket**.

Read [`SPEC_hackathon.md`](./SPEC_hackathon.md) — it is the source of truth. This README
covers running the thing.

## Stack

Node 22 · TypeScript · Express · React + Vite (built, served same-origin by Express) ·
Postgres · Drizzle ORM · Docker Compose. Auth is **mac-auth** (`auth.monashcoding.com`) —
EdDSA JWTs verified locally via JWKS. We never build auth.

## Build status

**Stage 1 complete** (of the 8-stage build order in the spec §12):

- Express + Vite + Drizzle + Docker Compose; `docker compose up -d` works from a clean clone.
- mac-auth JWT verification via JWKS (`src/server/auth/`).
- `events` table + append-only `audit_log`, with organiser-gated admin CRUD.
- A minimal organiser admin SPA (`web/`) to create/edit/publish/archive events.

Not yet built: Notion sync, public site, Humanitix sweep, verification, teams, dashboards.

## Run it (clean clone)

```bash
docker compose up -d
```

That brings up Postgres, waits for it to be healthy, runs Drizzle migrations, and starts
the app. Then:

- App: http://localhost:3000
- Health: http://localhost:3000/api/health → `{"status":"ok","db":"ok"}`

> **Port collisions.** If something already holds host port 3000 (e.g. a local mac-auth) or
> 5432 (a local Postgres), override:
>
> ```bash
> APP_PORT=3001 docker compose up -d      # app on :3001; db is on host :5433 by default
> ```

## Local development (hot reload)

```bash
npm install
cp .env.example .env          # DATABASE_URL points at the compose db on localhost:5433
docker compose up -d db       # just Postgres
npm run db:migrate            # apply migrations
npm run dev                   # Express (:3000) + Vite dev server (:5173, proxies /api)
```

Open the Vite dev server at http://localhost:5173.

## Signing in (admin)

The admin UI takes a **mac-auth bearer token** — we don't build a login flow here (that's
the public site's job in a later stage). Paste a token from mac-auth into the sign-in box.
Organiser access is granted when the token's `team` claim is one of `ORGANISER_TEAMS`
(default `committee`). Everyone else is a participant.

> The exact mac-auth claim names (`team`, `isMonash`, `email`) are our current understanding
> of the token shape and are parsed tolerantly in `src/server/auth/jwt.ts`. Confirm them
> against a real decoded token before relying on them.

## Database & migrations

```bash
npm run db:generate    # regenerate SQL migrations from src/server/db/schema.ts
npm run db:migrate     # apply pending migrations
npm run typecheck      # tsc --noEmit
```

Migrations live in `drizzle/` and are applied automatically on container start.

## Layout

```
src/server/        Express API
  env.ts           validated env access (fails loud at boot)
  db/              Drizzle schema, client, migrate runner
  auth/            mac-auth JWKS verification + requireAuth/requireOrganiser
  routes/          health, me, events (admin CRUD)
  lib/audit.ts     append-only audit writes
web/               React + Vite admin SPA (builds to dist/web)
drizzle/           generated SQL migrations
```

## Deployment

Dokploy Compose + Traefik on the Oracle Cloud ARM VM; GitHub Actions SSH deploy on push to
`main`. All secrets live in Dokploy env, sourced from role inboxes (`projects@monashcoding.com`)
— **no personal accounts anywhere in the dependency graph**. `POSTGRES_USER` /
`POSTGRES_PASSWORD` / `POSTGRES_DB` are all `mac_hackathon`.
