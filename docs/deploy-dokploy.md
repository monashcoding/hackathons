# Deploying on Dokploy

`hackathons.monashcoding.com` runs as a **Dokploy Compose** service (Compose + Traefik)
on the Oracle Cloud ARM VM. This is the runbook for standing it up and for the next
committee to inherit it with zero tribal knowledge.

**What's in the repo already:**
- [`docker-compose.dokploy.yml`](../docker-compose.dokploy.yml) — the production compose
  (Traefik labels, no host ports, secrets via `${VAR}` interpolation).
- [`Dockerfile`](../Dockerfile) + [`docker-entrypoint.sh`](../docker-entrypoint.sh) — build
  the app; the entrypoint runs Drizzle migrations then starts the server on every deploy.
- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — optional CI-gated
  deploy (only ships after tests pass).

> The plain `docker-compose.yml` is the **local dev** file and is not used in production.

---

## 1. DNS (once)

Point an A record for `hackathons.monashcoding.com` at the Oracle VM's public IP. Let's
Encrypt (via Traefik) needs this resolving before it can issue a certificate.

## 2. Create the Compose service in Dokploy

1. In Dokploy: **Create Project** (or use the MAC project) → **Create Service → Compose**.
2. **Provider = GitHub**, repo `monashcoding/hackathons`, branch **`mac-hackathon-mvp`**.
3. **Compose Path**: `docker-compose.dokploy.yml`.
4. Save. Don't deploy yet — set the environment first.

## 3. Environment variables (Dokploy → the service → Environment)

Paste these, filling in the real secrets. All secrets come from role inboxes
(`projects@monashcoding.com`) — **no personal accounts**.

```
# Organiser access is by mac-auth ROLE (committee/exec/admin), not the `team`
# claim. The default already covers the committee — usually leave it unset.
ORGANISER_ROLES=committee,exec,admin
HUMANITIX_API_KEY=<from Humanitix Console → Account → Advanced → Public API key>
TICKET_SYNC_REVOKE_THRESHOLD=0.20
DISCORD_ALERT_WEBHOOK_URL=<optional: a Discord webhook for sync-failure alerts>

# Notion content CMS (leave blank until the Notion databases exist; the site
# still runs — content sync just no-ops):
NOTION_API_KEY=
NOTION_EVENTS_DB_ID=
NOTION_PRIZES_DB_ID=
NOTION_JUDGES_DB_ID=
NOTION_SCHEDULE_DB_ID=
NOTION_SPONSORS_DB_ID=
NOTION_FAQ_DB_ID=
```

`DATABASE_URL`, `MAC_AUTH_*`, `JWT_AUDIENCE`, `PORT`, `PUBLIC_URL`, and the Postgres
credentials are hard-set in the compose file — you don't add them here.

> **Organiser access is role-based.** A signed-in user reaches `/admin` only if their
> mac-auth token carries a `committee`, `exec`, or `admin` role — these come from the central
> committee roster (curated in Notion, synced into mac-auth). If the director can't get in,
> confirm they're on that roster; you don't manage organisers in this app.
>
> **Single sign-on requires the `*.monashcoding.com` origin.** The dashboard/find-team/admin
> sign-in works because the app is served from `hackathons.monashcoding.com` and reads the
> shared mac-auth session cookie. It will NOT work from `localhost` or an IP — mac-auth only
> trusts `*.monashcoding.com` origins.

## 4. Domain / TLS

Dokploy → the service → **Domains** → add `hackathons.monashcoding.com`, **HTTPS on**,
certificate **Let's Encrypt**, container **port 3000**. (The compose already carries the
Traefik labels, so this mainly registers the domain + cert with Dokploy.)

The compose uses `tls.certresolver=letsencrypt` and entrypoint `websecure` — Dokploy's
defaults. If your Dokploy uses a differently-named cert resolver, update that label.

## 5. Deploy

Hit **Deploy**. Dokploy clones the branch, builds the image, brings up Postgres, waits for
its healthcheck, runs migrations, and starts the app. Watch the logs for:

```
[migrate] done.
[server] mac-hackathon listening on :3000 (production)
[ticket-cron] scheduled ticket sync ...
```

Then check:
- `https://hackathons.monashcoding.com/` — the public site.
- `https://hackathons.monashcoding.com/api/health` → `{"status":"ok","db":"ok"}`.

## 6. Auto-deploy on push (pick ONE)

- **CI-gated (recommended):** Dokploy service → **Deployments → Webhook URL**, copy it, and
  add it as a GitHub repo secret **`DOKPLOY_DEPLOY_WEBHOOK`**. Then `deploy.yml` redeploys
  after the `test` workflow passes on the default branch. (Also add a `HUMANITIX_API_KEY`
  repo secret if you want the live Humanitix test to run in CI; it skips without it.)
- **Native:** enable **Auto Deploy** on the Dokploy service (registers a GitHub webhook that
  redeploys on every push, tests or not) and delete `.github/workflows/deploy.yml`.

---

## Staging preview (persistent link for frontend work)

A **separate, throwaway** Dokploy service that runs the `frontend-redesign` branch at
`https://staging-hackathons.monashcoding.com`, so work-in-progress can be previewed on a
real URL **without ever touching production**. It uses its own compose file
([`docker-compose.staging.yml`](../docker-compose.staging.yml)), its own database, and
auto-seeds demo content on boot — so it's never blank and never hits Humanitix/Notion.

> **Why `staging-hackathons` and not `staging.hackathons`?** The domain sits behind
> Cloudflare, whose free Universal SSL cert covers `monashcoding.com` and `*.monashcoding.com`
> but **not** a nested `*.hackathons.monashcoding.com`. A host like
> `staging.hackathons.monashcoding.com` fails the TLS handshake at Cloudflare's edge
> (`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`) before it ever reaches Traefik. Keeping the preview a
> **single-level** subdomain means Cloudflare serves TLS automatically — no paid Advanced
> Certificate Manager to remember or renew.

1. **DNS (once).** In Cloudflare, add a record for `staging-hackathons.monashcoding.com`
   pointing at the same Oracle VM as production (mirror however the prod `hackathons` record is
   set up — same target, **proxied / orange cloud on**). Because it's one level deep, Universal
   SSL covers it with no extra certificate.
2. **Create a second Compose service** in Dokploy (name it e.g. `hackathons-staging`):
   - Provider = GitHub, repo `monashcoding/hackathons`, branch **`frontend-redesign`**.
   - **Compose Path**: `docker-compose.staging.yml`.
3. **Domain**: add `staging-hackathons.monashcoding.com`, HTTPS on, Let's Encrypt, port 3000.
4. **Environment**: none required — the staging compose hard-sets everything, including
   `ALLOW_SEED=1` (which makes the entrypoint seed demo content on every deploy) and
   `NODE_ENV=production` (so the built SPA is served). Leave the env box empty.
5. **Auto-deploy on push**: enable Dokploy's native **Auto Deploy** on this staging service.
   Then every push to `frontend-redesign` redeploys the preview automatically. (The CI-gated
   `deploy.yml` only fires for the production branch, so it won't interfere.)
6. **Deploy.** Watch the logs for `ALLOW_SEED=1 → seeding demo content…` then the usual
   `listening on :3000`. Visit the staging URL.

> **Public pages just work** on staging (landing, `/past`) — no sign-in needed, so that's the
> whole redesign surface covered. The **auth-gated pages** (`/dashboard`, `/find-team`,
> `/admin`) additionally need `staging-hackathons.monashcoding.com` added to **mac-auth's**
> `TRUSTED_ORIGINS`; until then they'll fail to sign in on staging (they still work locally
> via dev sign-in). Ask whoever administers mac-auth if she needs those pages live.

**Tearing it down** when the redesign lands: delete the staging service in Dokploy and remove
the `staging-hackathons` DNS record. `docker-compose.staging.yml` can stay in the repo for
next time.

---

## Operating notes

- **The database volume `db_data` is the only stateful thing.** Back it up before major
  changes. Redeploys reuse it; migrations are additive.
- **Dead Humanitix key?** The organiser dashboard's health banner shows `⚠️ FAILED`, and
  `GET /api/health/sync` reports per-source last-success. Regenerate the key in Humanitix,
  update `HUMANITIX_API_KEY` in Dokploy, redeploy. If a sweep would mass-revoke tickets it
  **aborts** and alerts instead — set `FORCE_TICKET_SYNC=1` only once you've confirmed the
  revocation is real, then unset it.
- **Next year's committee:** they do not fork the repo or edit code. They create the new
  event in the admin UI at `/admin`, map its Humanitix event id and ticket types there, and
  (optionally) point the Notion databases at the new event. Everything else is data.
