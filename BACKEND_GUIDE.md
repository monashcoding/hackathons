# Backend guide

You don't need this to redesign the frontend — but you asked to understand the whole stack,
and it'll make you a much stronger engineer to know what's happening on the *other side* of
every `fetch` you write. This is the companion to [`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md);
read that one first, because it sets up the big picture this doc drills into.

The backend's one job: **keep a fast, safe copy of the truth in Postgres, and hand out
exactly the right slice of it as JSON.** That's it. Everything below is detail on how.

> Everything backend lives under `src/server/`. It's plain **TypeScript + Express** (the web
> server) talking to **Postgres** (the database) through **Drizzle** (a type-safe query
> builder). No magic frameworks.

---

## 1. What a request actually does

Remember the frontend loop (page → `api.ts` → `fetch("/api/…")`). Here's what happens the
instant that `fetch` reaches the server:

```
   fetch("/api/public/past")
        │
        ▼
   src/server/index.ts          ← the front door. Matches the URL to a "router".
        │                          "/api/public/…" is handled by publicRouter.
        ▼
   src/server/routes/public.ts  ← the route handler. THE code that runs for this URL.
        │
        ▼
   Drizzle query on Postgres    ← db.select().from(events).where(...)
        │
        ▼
   res.json({ events: [...] })  ← turn the DB rows into JSON and send them back
```

So for any endpoint, there are only ever two questions:
1. **Which file handles this URL?** (Look in `index.ts` — it maps URL prefixes to routers.)
2. **What does that handler do?** (Read the route file — it's usually 5–15 lines.)

---

## 2. The file map

```
src/server/
  index.ts            THE FRONT DOOR. Wires every router to a URL prefix. Read this first.
  env.ts              Reads + validates environment variables. Fails loudly at boot if a
                      required secret is missing (better than a mystery crash at 2am).

  db/
    schema.ts         THE MOST IMPORTANT FILE. Defines every database table as TypeScript.
    index.ts          The database connection (the `db` object you query with).
    migrate.ts        Applies migrations on startup.

  auth/
    jwt.ts            Verifies mac-auth sign-in tokens. We never build our own login.
    middleware.ts     requireAuth / requireOrganiser — the guards you put on routes.

  routes/             One file per area. Each exports a "router" wired up in index.ts.
    health.ts         "is the server alive?"
    public.ts         public site data (no login needed)
    me.ts             "who am I?"
    dashboard.ts      the participant dashboard payload
    teams.ts          create/join/invite/leave teams
    events.ts         organiser event CRUD
    tickets.ts        trigger ticket syncs / CSV import
    organiser.ts      the gap report, override queue, exports
    stats.ts          👈 YOUR EXERCISE (a stub — see §6)

  content/            Notion → Postgres sync (the public-site content)
  tickets/            Humanitix → Postgres sync (who holds a ticket)
  teams/              team status rules (status is derived, never set by hand)
  participants/       verification logic
  lib/                small shared helpers (audit log, discord alerts, codes…)
```

If you only read two files to "get" the backend, read **`index.ts`** (how URLs map to code)
and **`db/schema.ts`** (what data exists). Everything else is variations on a theme.

---

## 3. The database, via Drizzle

Postgres stores the data in **tables** (like spreadsheets: `events`, `participants`, `teams`,
`tickets`…). We never write raw SQL by hand — we use **Drizzle**, which lets us describe
tables in TypeScript (`db/schema.ts`) and query them with autocomplete and type-checking.

A table definition (trimmed from `schema.ts`):

```ts
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),          // e.g. "2026"
  name: text("name").notNull(),
  isPublished: boolean("is_published").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  // …more columns
});
```

Querying it (from `routes/public.ts`) reads almost like English:

```ts
const rows = await db
  .select()
  .from(events)
  .where(and(eq(events.isPublished, true), eq(events.isArchived, true)))
  .orderBy(desc(events.startsAt));
```

`eq` = equals, `and` = both conditions, `desc` = newest first. That's 90% of what you need.

**Changing the shape of the database** (adding a column, a table) is a two-step ritual:
1. Edit `db/schema.ts`.
2. Run `npm run db:generate` — Drizzle writes a **migration** (a `.sql` file in `drizzle/`)
   describing the change, then `npm run db:migrate` applies it.

Migrations are how the database changes safely and repeatably, on every machine and in
production — never by hand-editing the live database. You won't need this for the stats
exercise (it only reads), but it's good to know the ritual exists.

---

## 4. A few backend principles worth understanding

These come straight from the project spec, and they explain *why* the code looks careful in
places. You don't have to memorise them — just recognise them when you see them:

- **Never expose raw database rows.** Public endpoints hand back a hand-picked *whitelist* of
  fields (see `toPublicEvent()` in `public.ts`). Internal stuff (a Humanitix event id, ticket
  PII) must never leak into a public JSON response. When you add an endpoint, decide on
  purpose what goes in it.
- **Auth is checked on the server, every time.** A hidden button in the UI is not security.
  Protected routes put a guard in front: `router.get("/me", requireAuth, handler)` (see
  `me.ts`). Organiser-only routes add `requireOrganiser`. The token's signature is
  re-verified on every request — we never trust what the browser claims.
- **Read from Postgres, not from Notion/Humanitix, on a page request.** Those are synced into
  Postgres on a timer (`content/`, `tickets/`). If Notion is down, the site is fine — it's
  serving the last good copy. A page render must be fast and must not depend on someone
  else's API being up.
- **Nothing is hard-deleted.** "Deleting" flips a flag (`isArchived`, a `withdrawn` status).
  The row stays. And every consequential action is written to an append-only `audit_log`, so
  we can always answer "who changed this, and when?"
- **Some things are computed, not stored.** A team's status (`forming` / `confirmed` / …) is
  *derived* from its members and their tickets (`teams/status.ts`), never set by hand — so it
  can't drift out of sync with reality.

You'll notice the ticket-sync code (`tickets/sync.ts`) is especially defensive — it has a
"safety gate" that refuses to un-verify a huge chunk of attendees in one sweep. That's
deliberate: it's the difference between a bug and 200 people locked out the night before the
event. Read the comments there if you're curious; it's a great example of *defensive backend
thinking*.

---

## 5. Running & poking at the backend

Same setup as the frontend guide (`npm install`, `docker compose up -d db`, `npm run db:seed`,
`npm run dev`).
Once it's running, the backend is at **http://localhost:3000** and you can hit endpoints
directly from your terminal — no frontend needed:

```bash
curl http://localhost:3000/api/health          # {"status":"ok","db":"ok"}
curl http://localhost:3000/api/public/past      # {"events":[...]}
curl http://localhost:3000/api/public/stats     # your exercise — see below
```

`curl` is just "make an HTTP request from the command line." It's the fastest way to check a
backend endpoint in isolation. (For endpoints that need login, it's easier to test through
the running site with dev sign-in — don't worry about auth for the exercise.)

When the backend crashes or misbehaves, look at the **terminal running `npm run dev`** — that's
where server errors and `console.log` output appear (the browser console only shows frontend
errors).

---

## 6. Exercise: your first endpoint  (`src/server/routes/stats.ts`)

A tiny, self-contained backend task that mirrors frontend Exercise 1 — but on the server
side. The file is already created, stubbed, and wired into `index.ts`, so it's live right now:
`curl http://localhost:3000/api/public/stats` returns `{"pastEventCount":0}`. Your job is to
make that number real.

**Goal:** make `GET /api/public/stats` return the actual count of past events.

**How to approach it:**
1. Open `src/server/routes/public.ts` and find the `/public/past` handler. It already queries
   for exactly the rows you want (published **and** archived events). You're reusing that
   `.where(...)` filter.
2. In `stats.ts`, run that query and return the *count* instead of the list. Simplest version:
   fetch the rows and return `rows.length`. (Uncomment the imports at the top of the file as
   you need them.)
3. Restart isn't needed — `npm run dev` reloads on save. Re-run the `curl` and watch the
   number change.

**How you'll know it works:** after `npm run db:seed` there are 2 past events, so a correct
implementation returns `{"pastEventCount":2}` (not `0`).

**Ties back to the frontend:** once it works, you could call it from a new `api.stats()` in
`web/src/api.ts` and show "N hackathons and counting" on your redesigned landing page — a
complete feature you built through *every* layer of the stack. That's the whole thing. 🎉

> Stretch: also return `publishedEventCount` (published but not archived). And if you want to
> see the full "add a column" ritual, ask Oliver for a small schema exercise.

---

## 7. What NOT to change (for now)

While you're finding your feet, steer clear of these unless you're pairing with Oliver — they
have sharp edges and real consequences:

- `tickets/sync.ts` and the safety gate — getting this wrong can lock real people out.
- `auth/` — we never build auth; mac-auth owns it.
- Anything that writes to `audit_log` or that hard-deletes a row (don't add hard deletes).
- `db/schema.ts` migrations on production data.

Adding *read-only* endpoints (like the stats exercise) is always safe. Start there.

Questions → ask Oliver. Welcome to the backend. 🚀
