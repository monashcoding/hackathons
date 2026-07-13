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

**All 8 stages of the spec §12 build order are complete.**

1. **Scaffold** — Express + Vite + Drizzle + Docker Compose (`docker compose up -d` from a
   clean clone), mac-auth JWKS verification, `events` table + append-only `audit_log` +
   organiser admin CRUD.
2. **Notion content sync + public site** — drift-tolerant `ContentSource` adapter, sanitise
   at sync time, served from Postgres; public landing + past-events pages.
3. **Humanitix sweep** — `TicketSource` adapter (Humanitix API **and** CSV importer), the
   mass-revocation safety gate, per-event cadence cron, `sync_runs` + health banner. Field
   mapping discovered live and documented in [`docs/humanitix-schema.md`](./docs/humanitix-schema.md).
4. **Verification** — email auto-match, order-reference + surname claim (rate-limited),
   organiser override queue, revocation via the sweep.
5. **Teams** — creation, invites (email + code), explicit acceptance, derived status
   (`forming`/`confirmed`/`flagged`/`withdrawn`), and all the §9 edge cases.
6. **Organiser dashboard** — team board, the gap report, confirmed-teams CSV export.
7. **Custom fields** — per-event questions; required ones block team confirmation.
8. **Looking-for-a-team pool** — verified solo participants opt in; leads invite from the pool.

Each stage was verified end-to-end (including against live MACATHON 2026 ticket data) before
commit. There is no automated test suite in the repo yet — a worthwhile next step.

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
