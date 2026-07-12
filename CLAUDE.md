# CLAUDE.md — mac-hackathon

Read `SPEC_hackathon.md` first. It is the source of truth. This file is the short version
plus the rules that are easy to get wrong.

## What this is

MAC's hackathon platform: a public info site (Notion-driven) + team registration where
**every participant is verified against a real, paid Humanitix ticket**.

**It is not a Devpost replacement.** Devpost keeps submissions and judging. If you find
yourself writing a submissions table, stop.

## The one-sentence justification

Teams currently register without their whole team, and organisers can't tell who actually
holds a ticket until event day. Linking the roster to Humanitix tickets fixes that, and
gives participants an unambiguous "you're registered" page so they stop DMing the director.

## Stack (do not deviate)

Node 22 · TypeScript · Express · React + Vite (built, served same-origin by Express) ·
Postgres (own container) · Drizzle ORM · node-cron · Dokploy Compose + Traefik ·
GitHub Actions SSH deploy on `main`.

`POSTGRES_USER` = `POSTGRES_PASSWORD` = `POSTGRES_DB` = `mac_hackathon`.

Auth is `mac-auth` (`auth.monashcoding.com`) — EdDSA JWTs verified locally via JWKS.
**Never build auth.**

Domain: `hackathons.monashcoding.com`.

## Handover survivability — the constraint behind every decision

The committee rotates yearly. Everything must be inheritable with **zero tribal knowledge**:

- No personal accounts anywhere in the dependency graph. Credentials come from role inboxes
  (`projects@monashcoding.com`). The Humanitix account is **club-owned** — confirmed.
- No paid tiers that can lapse.
- `docker compose up -d` from a clean clone must work.
- Next year's committee creates a new event **in the admin UI**. They do not fork the repo,
  they do not edit code, and they do not need to find whoever built this.
- If a decision requires someone to *remember* something, it's the wrong decision.

## Non-negotiables

1. **Humanitix is read-only.** Never write to it.
2. **Poll-and-reconcile, not webhooks.** Humanitix has no webhooks. Full sweeps.
3. **The mass-revocation safety gate.** A sweep that would revoke >20% of verified tickets
   (or that returns zero tickets) **aborts and alerts** rather than unverifying 200 people
   the night before the event. Override only via `FORCE_TICKET_SYNC=1`. Same principle as
   `FORCE_ROSTER_SYNC` in mac-auth.
4. **The CSV ticket importer is a first-class, tested code path**, behind the same
   `TicketSource` adapter interface as the API. It's the mid-event escape hatch when the
   API key breaks, and it's what saves the next committee if MAC switches ticketing platform.
5. **Order-reference claiming must exist.** People buy tickets with a personal Gmail and
   sign in with a uni account. Email auto-match alone fails for a large fraction of users.
   One order can contain a whole team's tickets — that case must work.
6. **The organiser override queue must exist.** Strict verification is only safe to enforce
   because there's a human release valve. Never strand a real paying attendee.
7. **Cache Notion in Postgres and serve from Postgres.** Never live-proxy on page render.
8. **Nothing is hard-deleted.** Mark and preserve. Append-only `audit_log`.
9. **No email domain gate.** The hackathon is open to anyone, any university, anywhere.
10. **No SMTP.** MAC has deliberately not built outbound email. In-app state + Discord.

## First task, before any sync code

Hit `GET https://api.humanitix.com/v1/events/69c39e46e5da8174a38f4355/tickets` with the real
`x-api-key` and dump a single record. Confirm the actual field names for attendee email,
order reference, ticket type, and status against the live payload. **Do not assume them
from the spec.** Persist the full payload in `tickets.raw` forever so future schema drift
is debuggable.

That ID is **MACATHON 2026** (`events.humanitix.com/macathon-2026`) — a real, closed past
event with real orders and tickets. Build the sync against it. It has the messy cases a
synthetic fixture won't: multi-ticket orders, refunds, name/email mismatches.

Facts from that listing, now baked into the defaults: **teams of 2–4** (so a solo participant
is never a valid team — the find-a-team pool is load-bearing), 48-hour event, and team
formation currently happens ad-hoc in the MAC Discord.

API notes: `pageSize` max 100 · rate limit 200 req/min · docs at `humanitix.stoplight.io`.
The short `7QVD6HEL`-style code is what attendees can actually find in their email — that's
the one to ask them for, **not** the long internal Mongo-style order ID.

## The page that matters most

`/dashboard`. If a participant reads it and still has to ask *"am I actually in the
hackathon?"*, the entire project has failed. Above the fold, unambiguous: your ticket state,
your team, and a per-member chip showing exactly who hasn't accepted and who hasn't bought
a ticket.

The organiser equivalent is the **gap report** — every ticket-holder with no team, every
team member with no ticket, every unaccepted invite. That's the view the director currently
rebuilds by hand, and it's the reason this project exists.

## Build order

Scaffold → Notion content + public site → Humanitix sweep + safety gate + CSV adapter →
verification → teams → organiser dashboard → custom fields → team-finding pool.

Ship the public site early. It's the stage that gives the director something to point at.

## Style

Match the existing MAC Suite repos. Boring, explicit, well-commented at the seams
(sync logic, safety gates, status derivation). Assume the next person to read this code
has never spoken to anyone who wrote it.
