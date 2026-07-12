# SPEC — MAC Hackathon Platform

`mac-hackathon` · `hackathons.monashcoding.com`

---

## 1. Purpose

A public information site for MAC hackathons **plus** a team registration system whose
defining feature is that **every registered participant is verified against a real,
paid Humanitix ticket**.

**This is not a Devpost replacement.** Devpost keeps handling project submissions and
judging. This platform owns everything *before* submission: information, tickets,
teams, and the verified roster that gets handed to Devpost.

### The two problems being solved

Direct from the Hackathon Director:

1. **"We don't know if these people exist until the very end."** Teams register without
   their whole team, or with people who never bought tickets. Organisers currently
   verify by hand or just trust them, and only discover gaps on event day.
2. **"People keep asking if they're even part of the hackathon."** Participants buy a
   ticket and then get no confirmation of registration state, generating a constant
   stream of DMs to the director.

Root cause of both: **the ticket and the team roster are two disconnected records with
no link between them.** This platform makes the ticket the source of truth and forces
the team roster to reconcile against it continuously.

### Definition of done

- A hackathon's public page (prizes, judges, schedule, sponsors, FAQ) is editable by a
  non-developer via Notion and updates without a deploy.
- A participant signs in, is matched to their Humanitix ticket, joins or creates a team,
  and sees an unambiguous "you are registered" state.
- A team lead can see, at any moment, exactly which of their members have not accepted
  the invite and which have not bought a ticket — **weeks before the event, not on the day.**
- An organiser can see every team's completeness at a glance, resolve edge cases, and
  export a clean confirmed roster as CSV for the Devpost handoff.
- Next year's committee creates a new event in the admin UI. They do not fork the repo,
  and they do not need to talk to anyone who built this.

---

## 2. Non-goals

- Project submissions. Devpost.
- Judging, scoring, leaderboards. Devpost.
- Payments or ticket sales. Humanitix.
- Outbound transactional email. MAC has deliberately not built email infrastructure.
  In-app state + Discord are the notification channels. **Do not add an SMTP dependency.**
- A general-purpose CMS. Notion is the CMS.

---

## 3. Stack & deployment

Identical conventions to the rest of the MAC Suite. Do not innovate here.

- **Runtime:** Node 22, TypeScript, Express
- **Frontend:** React + Vite SPA, **built and served same-origin by the Express app**
  (no CORS, no separate frontend container)
- **DB:** Postgres in its own container, Drizzle ORM, Drizzle migrations
- **Auth:** `mac-auth` at `auth.monashcoding.com` — EdDSA JWTs verified locally via JWKS.
  **Do not build auth.**
- **Scheduling:** `node-cron` in-process
- **Deploy:** Dokploy Compose + Traefik on the Oracle Cloud ARM VM; GitHub Actions
  SSH deploy on push to `main`
- **Convention:** `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` all = `mac_hackathon`
- **Must come up with a single `docker compose up -d` from a clean clone.**

### Environment variables

```
DATABASE_URL=
PORT=3000
PUBLIC_URL=https://hackathons.monashcoding.com

# mac-auth
MAC_AUTH_URL=https://auth.monashcoding.com
MAC_AUTH_JWKS_URL=https://auth.monashcoding.com/api/auth/jwks

# Humanitix (club-owned account, key from Account > Advanced > Public API key)
HUMANITIX_API_KEY=
HUMANITIX_API_BASE=https://api.humanitix.com/v1

# Notion (content CMS)
NOTION_API_KEY=
NOTION_EVENTS_DB_ID=
NOTION_PRIZES_DB_ID=
NOTION_JUDGES_DB_ID=
NOTION_SCHEDULE_DB_ID=
NOTION_SPONSORS_DB_ID=
NOTION_FAQ_DB_ID=

# Sync safety
FORCE_TICKET_SYNC=            # set to 1 to allow a sweep that would mass-revoke
TICKET_SYNC_REVOKE_THRESHOLD=0.20

# Optional: Discord webhook for sync-failure alerts
DISCORD_ALERT_WEBHOOK_URL=
```

All secrets live in Dokploy env, sourced from role inboxes (`projects@monashcoding.com`).
**No personal accounts anywhere in the dependency graph.**

---

## 4. Identity model

Everyone signs in via `mac-auth` (Google or Microsoft social login). `macUserId` from the
JWT is the canonical user key.

**This event is open to anyone at all** — not just Monash students. There is **no email
domain gate**. `isMonash` from the JWT is informational only and must never gate access.

The `university` field is **self-declared free text collected at registration**, not
derived from the email domain. Do not attempt to infer it.

**Known accepted limitation:** mac-auth only supports Google and Microsoft. A user whose
only email is Yahoo/Proton/etc. must sign in with a free Google or Microsoft account
instead. This is accepted — the sign-in identity does **not** need to match the ticket
email (see the order-reference claim flow), so this never blocks ticket verification.
Surface a clear line on the sign-in page: *"Sign in with any Google or Microsoft account
— it doesn't need to be the email you bought your ticket with."*

**Roles**
- `participant` — default for any signed-in user
- `organiser` — from mac-auth JWT claims (MAC committee `team` claim) **or** an
  event-scoped `organisers` table for non-committee helpers. Never invent a new
  global role in mac-auth.

---

## 5. Data model

Multi-event from day one. Every table below (except `users` mirror) is event-scoped.

### `events`
```
id, slug (e.g. "2026"), name, tagline, starts_at, ends_at, venue,
registration_opens_at, registration_closes_at,
min_team_size (default 2), max_team_size (default 4),   -- MACATHON runs teams of 2-4
humanitix_event_id,
participant_ticket_types  jsonb  -- ticket type names that count as a participant
mentor_ticket_types       jsonb  -- ticket type names that count as a mentor/volunteer
devpost_url, is_published, is_archived,
created_at, updated_at
```

Timestamps stored **UTC**, rendered in Melbourne local time. **Never trust client time**
for window checks — registration open/close is evaluated server-side.

### `participants`
One row per signed-in human per event.
```
id, event_id, mac_user_id,
display_name, university (free text), study_level, dietary, github_handle, discord_handle,
looking_for_team boolean default false,
verification_status enum('unverified','verified','revoked','override'),
verified_at, verified_via enum('email_match','order_reference','exec_override'),
created_at, updated_at
UNIQUE (event_id, mac_user_id)
```

### `tickets`
Mirror of Humanitix state. **Never write back to Humanitix. This is read-only.**
```
id,
event_id,
humanitix_ticket_id      -- the ticket _id from the API. STABLE KEY. Unique.
humanitix_order_id       -- internal order _id (e.g. 5ac599d1a488620e6cd01d87)
order_reference          -- the SHORT human-visible code (e.g. "7QVD6HEL"). This is what
                         -- attendees can actually find in their confirmation email.
ticket_type_name,
attendee_first_name, attendee_last_name, attendee_email_normalised,
status enum('complete','cancelled','refunded','unknown'),
claimed_by_participant_id  -- nullable, UNIQUE. One ticket, one human. No sharing.
first_seen_at, last_seen_at,
raw jsonb                -- full API payload, for debugging schema drift
UNIQUE (humanitix_ticket_id)
UNIQUE (claimed_by_participant_id) WHERE claimed_by_participant_id IS NOT NULL
```

### `teams`
```
id, event_id, name (unique per event, case-insensitive),
lead_participant_id,
invite_code (revocable, regenerable),
status enum('forming','confirmed','flagged','withdrawn'),
devpost_note, created_at, updated_at
```

### `team_members`
```
id, team_id, participant_id,
role enum('lead','member'),
membership_status enum('invited','accepted','declined','removed'),
invited_at, responded_at
UNIQUE (team_id, participant_id)
```
A participant may be in **at most one non-withdrawn team per event**. Enforce in DB with
a partial unique index, not just in application code.

### `invites`
```
id, team_id, email_normalised, status enum('pending','accepted','declined','revoked','expired'),
invited_by_participant_id, expires_at, created_at
```
Invites are addressed to an **email**, not a user — the invitee may not have an account yet.
On first sign-in, resolve any pending invites matching the new user's email.

### `custom_fields` / `custom_field_responses`
Per-event organiser-defined questions (dietary, t-shirt size, track, "how did you hear
about us"). Mandatory ones block team confirmation.
```
custom_fields: id, event_id, label, type enum('text','select','multiselect','checkbox'),
               options jsonb, required boolean, sort_order, applies_to enum('participant','team')
custom_field_responses: id, custom_field_id, participant_id | team_id, value jsonb
```

### `content_blocks`
Notion cache. See §7.
```
id, event_id, kind enum('prize','judge','schedule_item','sponsor','faq','page'),
notion_page_id UNIQUE, payload jsonb, sort_order, is_published, synced_at
```

### `audit_log`
Append-only. Every verification, override, revocation, team status change, sync run.
```
id, event_id, actor_mac_user_id (nullable for system), action, subject_type, subject_id,
detail jsonb, created_at
```
**Never hard-delete a participant, team, ticket, or membership.** Mark and preserve.

### `sync_runs`
```
id, source enum('humanitix','notion'), event_id, started_at, finished_at,
status enum('success','failed','aborted_safety'),
records_seen, records_changed, records_would_revoke, error text
```
Drives the "last successful sync" health banner. This table is the single most important
operational-visibility feature in the app.

---

## 6. Humanitix integration

### API facts (verified July 2026 — re-verify against the live docs before building)

- Base: `https://api.humanitix.com/v1`
- Auth: `x-api-key: <key>` header on every request. Key is **account-level**, generated at
  Humanitix Console → Account → Advanced → Public API key.
- Read-only for our purposes. Endpoints: `GET /events`, `GET /events/{eventId}`,
  `GET /events/{eventId}/orders`, `GET /events/{eventId}/tickets`
- Pagination: `page` and `pageSize` query params, `pageSize` **max 100**. Responses carry
  `total`, `page`, `pageSize` plus the record array.
- Rate limit: **200 requests/minute**
- **There are no webhooks.** Zapier's "new attendee" triggers are Zapier polling on your
  behalf, not a push from Humanitix. This integration is **poll-and-reconcile**, full stop.
- Docs: `https://humanitix.stoplight.io/` and `https://api.humanitix.com/v1/documentation`

> **First build step: schema discovery.** Before writing the sync, hit
> `GET /events/{eventId}/tickets` once with the real key and dump one record to a file.
> Field names for attendee email / order reference / ticket type / status must be
> confirmed against the live payload, **not assumed from this spec.** Store the whole
> record in `tickets.raw` permanently so future schema drift is debuggable.
>
> **Reference event for schema discovery: MACATHON 2026.**
> - Public page: `https://events.humanitix.com/macathon-2026`
> - Humanitix event ID: **`69c39e46e5da8174a38f4355`**
> - Ran 10–12 April 2026, LG02 Alan Finkel Building, Clayton. Now closed.
>
> This is a **real past event with real orders and real tickets**. Use it to discover the
> payload schema and to build the sync against realistic data — including the messy cases
> (multi-ticket orders, refunds, name/email mismatches) that a synthetic fixture won't have.
> A closed event is ideal for this: nothing can be accidentally mutated, and the API is
> read-only anyway.

### The sweep

A full reconciliation sweep, not an incremental delta:

1. Page through **all** tickets for `event.humanitix_event_id` (100/page, respect the
   200/min limit with a small delay between pages).
2. Upsert each ticket on `humanitix_ticket_id`. Set `last_seen_at = now()`.
3. Any ticket in our DB for this event **not** seen in this sweep, or seen with a
   cancelled/refunded status → candidate for revocation.
4. **Safety gate (see below).** If it passes, apply revocations.
5. Recompute `verification_status` for affected participants, then recompute `status`
   for every team containing them.
6. Write a `sync_runs` row. Always. Success or failure.

**Cadence**
- Every **10 minutes** while `now()` is between `registration_opens_at` and
  `registration_closes_at`, and for the duration of the event itself (walk-up and
  on-the-day ticket sales are real).
- Every **60 minutes** otherwise.
- A **"Sync now"** button in the organiser dashboard. Non-negotiable — the director will
  need it while standing next to a confused attendee.

### The mass-revocation safety gate

This is the same principle as `FORCE_ROSTER_SYNC=1` in mac-auth, and it exists because a
bad API key, a wrong event ID, or a Humanitix 500 will return an empty or truncated list,
and a naive sync would cheerfully unverify 200 people the night before the event.

```
if (would_revoke / currently_verified) > TICKET_SYNC_REVOKE_THRESHOLD  // default 0.20
   and FORCE_TICKET_SYNC !== '1':
      abort. change nothing.
      write sync_runs { status: 'aborted_safety', records_would_revoke: n }
      raise a loud banner in the organiser dashboard
      POST to DISCORD_ALERT_WEBHOOK_URL if configured
```

Also abort unconditionally if the sweep returns **zero** tickets while we currently hold
verified ones. Zero is never a legitimate answer to "how many tickets does this event have."

### The adapter seam — mandatory, not optional

Ticket ingestion sits behind an interface:

```ts
interface TicketSource {
  fetchTickets(event: Event): Promise<NormalisedTicket[]>;
}
```

Two implementations, **both first-class and both tested**:

- `HumanitixTicketSource` — the API path above.
- `CsvTicketSource` — organiser uploads the Humanitix attendee CSV export in the admin UI;
  it is normalised through the *exact same* upsert + safety-gate path.

The CSV path is not a panic button nobody has ever run. It is the escape hatch when the API
key breaks mid-event, **and** it is what saves the next committee if MAC ever moves to
Eventbrite or TryBooking — they write one adapter and nothing else changes. Test it.

### The API key is a handover liability — mitigate it explicitly

Generating a new Humanitix API key **invalidates the previous one**, and the key is
account-level. A future exec regenerating the key for an unrelated reason will silently
kill this sync.

Required mitigations:
1. A **persistent health banner** in the organiser dashboard, always visible:
   `Ticket sync: ✅ 4 minutes ago` / `⚠️ FAILED — last success 14 hours ago`.
   A dead key must be *visible*, not discovered.
2. `GET /api/health/sync` returning last-success timestamps per source.
3. Discord alert webhook on two consecutive failures.
4. `README.md` documents, in plain English, where the key comes from, that the Humanitix
   account is **club-owned** (confirmed), and that regenerating the key requires updating
   `HUMANITIX_API_KEY` in Dokploy.
5. The CSV fallback, above.

### Ticket types

`event.participant_ticket_types` lists which Humanitix ticket type names count as a
participant. A mentor/volunteer/spectator ticket verifies the person's presence but makes
them **ineligible for team membership**. This must be configurable per event in the admin
UI, because ticket type names will change every year and nobody should need a code change.

---

## 7. Notion content sync (CMS)

Mirrors the existing `mac-auth` roster sync pattern exactly.

Notion databases (one each, all with an `Event` relation or an `Event Slug` text property):
**Prizes**, **Judges**, **Schedule**, **Sponsors**, **FAQ**. Plus a **Hackathon Events**
database as the master list.

- Hourly `node-cron` sweep + a manual "Sync content" button.
- Upsert into `content_blocks` keyed on **`notion_page_id`** — the stable key. Never key on
  title or name; those get edited.
- **Render into Postgres. Serve from Postgres. Never live-proxy Notion on a page request.**
  If Notion is down, or someone deletes a row at 2am the night before, the site keeps
  serving the last good snapshot.
- Unpublished/draft rows in Notion (a `Published` checkbox) do not appear on the site.
- Notion rich text → sanitised HTML at sync time, stored rendered. Sanitise on the way in.

---

## 8. Verification flows

### 8.1 Auto-match (the happy path)

On sign-in / registration, normalise the user's email (lowercase, trim; strip Gmail dots
and `+suffix` — students absolutely do this) and look for an unclaimed ticket in this event
with a matching normalised attendee email and a participant ticket type.

Match → claim the ticket, `verified_via = 'email_match'`, done. No user action.

### 8.2 Claim by order reference (the one that makes this work)

Email mismatch is **guaranteed** at scale — people buy with a personal Gmail and sign in
with a uni account. Without this flow the system fails for a third of users.

The participant enters:
- their **order reference** (the short human code, e.g. `7QVD6HEL` — the one in their
  Humanitix confirmation email, *not* the long internal ID)
- their **surname** (as a second factor so a leaked reference alone isn't enough)

Match against an unclaimed participant ticket → claim it. `verified_via = 'order_reference'`.

Guards:
- Rate limit: **5 attempts per user per hour**, then lock and route to organiser override.
- A ticket already claimed by someone else returns *"this ticket has already been claimed —
  contact the organisers"*, never *"wrong surname"*. Don't leak.
- One order may contain **multiple tickets** (someone buys for their whole team). The
  claimant takes **one** ticket from that order — match on the attendee name within the
  order where possible, otherwise take the first unclaimed one and let the rest be claimed
  by their teammates using the same order reference. **This is the common case for teams
  and must work.**

### 8.3 Organiser override

Anything unresolved lands in an override queue with the participant's stated details.
Organiser can manually verify with a **mandatory note**, written to `audit_log`.
`verified_via = 'exec_override'`.

Never let a failed match strand a real, paying attendee on event morning. The override
queue is the release valve that makes strict verification safe to enforce.

### 8.4 Revocation

A refunded, cancelled, or transferred ticket is detected by the sweep.

- Participant → `revoked`. The ticket is released (`claimed_by_participant_id = NULL`) so a
  transferee can claim it.
- Their team → `flagged`, **not** dissolved, **not** silently repaired.
- The **team lead** is shown the problem prominently.
- Audit log records it.

**This is the entire fix for problem #1.** A missing teammate stops being the organiser's
problem discovered on event day and becomes the team lead's problem, surfaced in week one.

---

## 9. Teams

### Lifecycle

Lead creates a team → invites members by email (or shares an invite code) → each invitee
signs in, **explicitly accepts** (nobody is added to a team without their consent), and must
be **ticket-verified**.

### Status is derived, never wished into existence

Recompute on every relevant mutation and after every ticket sweep:

- **`forming`** — below `min_team_size`, or has any member who is `invited` (not accepted),
  or has any member who is not `verified`/`override`, or has unanswered required custom fields.
- **`confirmed`** — every member has `membership_status = 'accepted'` **and**
  `verification_status ∈ ('verified','override')`, size within `[min,max]`, all required
  custom fields answered.
- **`flagged`** — was `confirmed`, then a member's ticket was revoked.
- **`withdrawn`** — soft-deleted. Preserved.

### Edge cases that must be handled

- Invitee never accepts → stays `invited` forever, team stays `forming`, lead can re-invite
  or remove. Visible, never silent.
- Invite sent to an email with no account → the invite waits; it resolves on that person's
  first sign-in.
- Accepting an invite invalidates all other pending invites for that participant (one team
  per person per event).
- Lead leaves → must **reassign lead first**. Last remaining member leaving dissolves the
  team (→ `withdrawn`).
- Lead removes a member → membership → `removed`, preserved in the audit log, ticket released.
- Team drops below `min_team_size` → back to `forming`, surfaced loudly.
- Registration window closed → block team creation and joins. Organiser override exists.
- Invite codes are revocable and regenerable. Optional max-uses and expiry.
- A participant with only a **mentor** ticket cannot join a team.

### The "looking for a team" pool

**This is load-bearing, not a nice-to-have.** Minimum team size is 2, so a solo ticket-holder
is *never* a valid team. Every solo buyer is, by definition, a blocked registration until
they find teammates.

This already happens — the Humanitix listing tells people to *"band together with your friends
or find a team on the MAC Discord."* Right now that's an unstructured scroll through a Discord
channel, and the organisers have no visibility into who's still stranded. The pool doesn't
replace that behaviour; it gives it structure and makes the stranded people **countable**.

Verified solo participants opt in (`looking_for_team`) and are visible to each other and to
team leads with open slots: display name, university, skills, GitHub. Leads can invite
directly from the pool.

Keep it simple: a browsable list + an "invite to my team" button. **No chat.** No DMs to build,
no moderation surface, no abuse vector. The conversation continues on Discord — link out to it.

The organiser view of this pool ("N verified participants still have no team") belongs in the
gap report.

---

## 10. Surfaces

### Public (no auth)
- `/` — current/next event landing page: hero, dates, venue, CTA to buy tickets on
  Humanitix, prizes, judges, schedule, sponsors, FAQ. All from `content_blocks`.
- `/past` — archive of previous events. Every year this gets better and it costs nothing.
- Clean, fast, mobile-first. This page is the club's public face — it gets shared on
  socials and read on a phone.

### Participant (auth)
- **`/dashboard` — the single most important page in the app.** It must answer, above the
  fold, with zero ambiguity:
  - ✅ *"You're registered for MAC Hackathon 2026."*
  - Your ticket: verified / needs claiming / **problem, here's exactly what to do**
  - Your team: name, every member with a per-person state chip
    (✅ confirmed · ⏳ hasn't accepted the invite · ⚠️ no ticket)
  - **This page is the answer to every DM the director currently receives.** If a participant
    still has to ask "am I actually in?", this page has failed. Design it accordingly.
- `/team/new`, `/team/:id` — create, invite, manage, leave, reassign lead
- `/claim` — order-reference ticket claim flow
- `/find-team` — the pool

### Organiser (role-gated)
- **Health banner, always visible**: last successful ticket sync + last content sync
- Team board: every team, status chip, member breakdown, filterable by `flagged` / `forming`
- **The gap report** — the director's most-used view. Every participant with a ticket but
  no team; every team member without a ticket; every unaccepted invite. This is the thing
  he currently reconstructs by hand.
- Override queue
- Event settings: dates, windows, team sizes, ticket type mapping, custom fields
- **CSV export of confirmed teams for the Devpost handoff** (team name, member names,
  emails, universities)
- CSV ticket import (the fallback adapter)
- Audit log viewer

---

## 11. Security

- Role-gate all organiser routes **server-side**. A hidden UI button is not access control.
- Participant emails are visible **only** to organisers and to the lead of that participant's
  own team. Not to the "looking for a team" pool. Not in any public JSON.
- Rate-limit ticket claiming (§8.2) and team creation.
- Sanitise all Notion-sourced HTML at sync time.
- `tickets.raw` may contain PII — never expose it through any participant-facing endpoint.
- Validate the JWT signature against JWKS on every request. Never trust claims from the client.
- Invite codes: unguessable (not sequential), revocable, optionally expiring.

---

## 12. Build order

Ship in this order. Each stage is independently useful and independently demoable.

1. **Scaffold** — Express + Vite + Drizzle + Docker Compose, `docker compose up -d` works
   from a clean clone. mac-auth JWT verification. `events` table + admin CRUD.
2. **Notion content sync + public site.** Ships before registration even opens; the director
   gets something to point at immediately. This is the stage that buys goodwill.
3. **Humanitix schema discovery** (dump one real ticket payload), then the sweep, the safety
   gate, the CSV adapter, `sync_runs` + health banner.
4. **Participants + verification** — auto-match, order-reference claim, override queue.
5. **Teams** — creation, invites, acceptance, derived status, all the edge cases in §9.
6. **Organiser dashboard** — team board, gap report, CSV export.
7. **Custom fields.**
8. **Looking-for-a-team pool.**

## 13. What NOT to do

- **Don't build auth.** Use mac-auth.
- **Don't rebuild Devpost.** No submissions. No judging. Scope creep here kills the project.
- **Don't write to Humanitix.** Read-only. Ever.
- **Don't live-proxy Notion** on page render. Cache in Postgres.
- **Don't add anyone to a team without explicit acceptance.**
- **Don't hard-delete** a participant, ticket, team, or membership. Mark and preserve.
- **Don't let a sync mass-revoke** without the safety gate.
- **Don't gate on email domain.** The event is open to everyone.
- **Don't infer university from the email domain.** Ask.
- **Don't trust client time** for registration windows.
- **Don't hardcode ticket type names**, event IDs, or dates. All are per-event config.
- **Don't add SMTP.** In-app state and Discord are the channels.
- **Don't build chat** in the team-finding pool.
- **Don't leave the CSV importer untested.** It is the disaster-recovery path.

## 14. Future extensions (do not build now)

- Discord bot integration: auto-create a private channel per confirmed team; push
  announcements. Slots naturally into the existing MAC Discord bot.
- On-the-day QR check-in — reuse the membership-card scanner rather than building a new one.
- Participation certificates — reuse the membership-card signing infra.
- Sponsor challenge tracks with their own prizes.
- Post-event feedback + analytics.
