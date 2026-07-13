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
ORGANISER_TEAMS=committee            # must match the mac-auth committee `team` claim
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

`DATABASE_URL`, `MAC_AUTH_*`, `PORT`, `PUBLIC_URL`, and the Postgres credentials are hard-set
in the compose file — you don't add them here.

> **Confirm `ORGANISER_TEAMS`.** Organiser access is granted when a mac-auth JWT's `team`
> claim is in this list. Decode a real committee token and set the exact value, or nobody
> can reach the organiser dashboard.

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
