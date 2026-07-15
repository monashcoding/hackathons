# mac-hackathon

MAC's hackathon platform: a public info site (Notion-driven) plus team registration where
**every participant is verified against a real, paid Humanitix ticket**.

Read [`SPEC_hackathon.md`](./SPEC_hackathon.md) — it is the source of truth. This README
covers running the thing.

> **New here / redesigning the frontend?** Start with [`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md) —
> a from-scratch walkthrough of how the frontend works, how it talks to the backend, and two
> hands-on exercises. Then [`BACKEND_GUIDE.md`](./BACKEND_GUIDE.md) explains the server side
> (Express + Drizzle + Postgres) with a matching exercise.

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
cp .env.example .env          # then set DATABASE_URL=...@localhost:5433/mac_hackathon and DEV_AUTH=1
docker compose up -d db       # just Postgres (host port 5433)
npm run db:migrate            # apply migrations
npm run dev                   # Express (:3000, loads .env) + Vite dev server (:5173, proxies /api)
```

Open the Vite dev server at http://localhost:5173.

**Auth in local dev.** Real mac-auth SSO only works on a `*.monashcoding.com` origin, so
localhost uses a **dev sign-in**: with `DEV_AUTH=1` set, the sign-in panel lets you pick a
name/email and an "organiser" toggle, and the backend accepts the resulting self-issued
`dev:` token. This bypass is double-gated (`DEV_AUTH=1` **and** `NODE_ENV != production`), so
it can never be enabled on the deployed app — production always requires a real mac-auth JWT.

## Signing in

Auth is **mac-auth single sign-on** (see mac-auth's `INTEGRATION.md`). The SPA starts a
redirect sign-in (`POST /api/auth/sign-in/social`), then mints a short-lived JWT from the
shared `.monashcoding.com` session cookie (`GET /api/auth/token`) and sends it as a Bearer
token to our API, which verifies it locally against mac-auth's JWKS (`src/server/auth/jwt.ts`).
Tokens live 15 minutes and are refreshed automatically (`web/src/auth.ts`).

Organiser access (the `/admin` surface) is granted by **role** — a `committee`, `exec`, or
`admin` role in the token (`ORGANISER_ROLES`), sourced from the central committee roster. The
`team` claim is informational and never gates access.

> **SSO only works on a `*.monashcoding.com` origin** (the session cookie's scope). On
> `localhost` mac-auth won't issue a token unless your dev origin is added to its
> `TRUSTED_ORIGINS` — so auth-gated pages are best tested on the deployed site.

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
  routes/          health, me, public (Notion-cached site), content, dashboard,
                   teams, invites, events + tickets (admin), organiser
  content/         ContentSource (Notion) sync + sanitise
  tickets/         TicketSource adapters (Humanitix API + CSV), sweep + safety gate
  participants/    verification + order-reference claiming
  teams/           team formation, invites, derived status
  customfields/    per-event participant/team questions
  organiser/       team board, gap report, CSV export
  lib/audit.ts     append-only audit writes
web/               React + Vite SPA (public site + participant + admin), builds to dist/web
  src/pages/       Landing, Dashboard (ticket/verify/details), FindTeam (Team hub), Past, Admin
  src/components/  TopNav, TeamPanels, ClaimForm, CustomFieldsForm, SignInPanel
  src/styles.css   Tailwind v4 theme tokens — MAC yellow on #252525 (mirrors monashcoding.com)
drizzle/           generated SQL migrations
```

The SPA has two participant pages, split by responsibility: **Dashboard** is the
"am I registered?" page (ticket state, the verify/claim flow, personal details), and
**Team** (`/find-team`) hosts all team formation — your team, invites, questions, and the
looking-for-a-team pool — gated behind ticket verification. One shared `<TopNav>` with two
tabs (Dashboard, Team) sits on every page; the `/admin` organiser surface is reachable by URL
but not linked in the nav.

## Deployment

Dokploy Compose + Traefik on the Oracle Cloud ARM VM, serving `hackathons.monashcoding.com`.
The production compose is [`docker-compose.dokploy.yml`](./docker-compose.dokploy.yml) (the
plain `docker-compose.yml` is local-dev only). CI runs on every push
([`.github/workflows/test.yml`](./.github/workflows/test.yml)) and an optional CI-gated
deploy ([`deploy.yml`](./.github/workflows/deploy.yml)) redeploys after tests pass.

**Full step-by-step runbook: [`docs/deploy-dokploy.md`](./docs/deploy-dokploy.md).**

All secrets live in Dokploy env, sourced from role inboxes (`projects@monashcoding.com`) —
**no personal accounts anywhere in the dependency graph**. `POSTGRES_USER` /
`POSTGRES_PASSWORD` / `POSTGRES_DB` are all `mac_hackathon`.
