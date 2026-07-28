# Backend guide — the other half (Part 2 of 2)

You made it to Part 2. 👋 If you've done the frontend guide and its two exercises, you already
know more than you think — you just know it from the *dining room* side. This guide walks you
through the kitchen door.

You don't strictly need any of this to make the frontend beautiful. But every `api.…` call you
wrote in Part 1 disappeared through a door, and I don't want that door to feel like magic.
Understanding what's behind it will make you noticeably better at the frontend too — you'll
know *why* an endpoint returns what it does, and what's easy vs. hard to change.

> **Read [`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md) first.** This guide reuses its restaurant
> picture (dining room / waiter / kitchen / pantry / suppliers) and starts exactly where it
> stopped: the moment the waiter pushes through the kitchen door.

The kitchen's whole job, in one sentence: **keep a fast, safe copy of the truth in the pantry,
and plate up exactly the right slice of it as JSON.** Everything below is just *how*.

> It's all under `src/server/`, and it's refreshingly boring tech on purpose: **TypeScript +
> Express** (the web server) talking to **Postgres** (the database) through **Drizzle** (a
> type-safe way to write database queries). No mysterious framework magic.

---

## 1. What happens after the waiter pushes through the door

In Part 1, a page asked the waiter (`web/src/api.ts`) for data and the waiter did a `fetch` to
`/api/…`. Here's the rest of that same journey — the kitchen side:

```
   the waiter's order arrives:  GET /api/public/past
        │
        ▼
   src/server/index.ts          ← the kitchen door. Sends each order to the right station.
        │                          "/api/public/…" → the publicRouter station.
        ▼
   src/server/routes/public.ts  ← the station. The actual code that fills this order.
        │
        ▼
   a Drizzle query on Postgres  ← "grab the matching rows from the pantry"
        │                          db.select().from(events).where(...)
        ▼
   res.json({ events: [...] })  ← plate it up as JSON and hand it back to the waiter
```

That's the whole shape. For *any* endpoint in the app, you only ever need to answer two
questions:

1. **Which file fills this order?** → open `src/server/index.ts`; it maps each URL prefix to a
   station (a "router").
2. **What does that station do?** → open the route file; most handlers are 5–15 readable lines.

If you can answer those two, you can find and understand any behaviour in the backend.

---

## 2. The kitchen, room by room

Everything's under `src/server/`. You can ignore most of it at first — the two files that
matter most are marked.

```
src/server/
  index.ts            ⭐ THE KITCHEN DOOR. Wires every station to a URL. Read this first.
  env.ts              Reads + checks environment variables. Refuses to start if a required
                      secret is missing — a loud failure now beats a mystery crash at 2am.

  db/
    schema.ts         ⭐ THE MOST IMPORTANT FILE. Describes every pantry shelf (table).
    index.ts          The pantry connection — the `db` object you run queries on.
    migrate.ts        Applies database changes on startup.

  auth/
    jwt.ts            Checks sign-in tokens from mac-auth. We never build our own login.
    middleware.ts     requireAuth / requireOrganiser — the "members only" guards for routes.

  routes/             One file per area. Each is a station wired up in index.ts.
    health.ts         "is the kitchen alive?"
    public.ts         public site data (no sign-in)
    me.ts             "who am I?"
    dashboard.ts      everything the participant dashboard needs
    teams.ts          create / join / invite / leave teams
    events.ts         organiser event management
    tickets.ts        trigger ticket syncs / CSV import
    organiser.ts      the gap report, override queue, CSV exports
    stats.ts          👈 YOUR EXERCISE (a stub — see §6)

  content/            the Notion → pantry delivery (public-site content)
  tickets/            the Humanitix → pantry delivery (who holds a ticket)
  teams/              team status rules (status is worked out, never set by hand)
  participants/       ticket-verification logic
  lib/                small shared helpers (audit log, Discord alerts, codes…)
```

Honestly, if you read just two files to "get" the backend, read **`index.ts`** (how orders
find their station) and **`db/schema.ts`** (what data exists at all). Everything else is a
variation on the pattern in §1.

---

## 3. The pantry, via Drizzle

The database keeps data in **tables** — think spreadsheets: an `events` table, a
`participants` table, a `teams` table, and so on. We never hand-write SQL; instead we use
**Drizzle**, which lets us describe each table in TypeScript and then query it with real
autocomplete and type-checking (so your editor catches typos before the code ever runs).

Here's a table, trimmed from `db/schema.ts`:

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

And here's a real query against it, from `routes/public.ts` — notice it reads almost like a
sentence:

```ts
const rows = await db
  .select()
  .from(events)
  .where(and(eq(events.isPublished, true), eq(events.isArchived, true)))
  .orderBy(desc(events.startsAt));
```

`eq` = "equals", `and` = "both of these are true", `desc` = "newest first". That small
vocabulary covers most of what you'll ever write.

**Changing the pantry's shelves** — adding a column or a whole table — is a little two-step
ritual worth knowing exists (you won't need it for the exercise, which only reads):

1. Edit `db/schema.ts`.
2. Run `npm run db:generate`. Drizzle writes a **migration** — a `.sql` file in `drizzle/`
   describing the change — and `npm run db:migrate` applies it.

Migrations are how the database changes the same way everywhere: your laptop, staging, and
production, all in the right order, without anyone hand-editing a live database at midnight.

---

## 4. Why the kitchen looks so careful (the house rules)

You'll notice the backend is written defensively in places. That's not paranoia — each rule
below comes from a real "imagine if this went wrong the night before the event" scenario. You
don't need to memorise them; just recognise them when you see them, because they explain a lot
of the code's shape:

- **Never send raw pantry rows out to guests.** Public endpoints hand back a hand-picked
  *whitelist* of fields (see `toPublicEvent()` in `public.ts`). Internal things — a Humanitix
  id, someone's personal details — must never slip into a public response. When you write an
  endpoint, choose on purpose what goes in it.
- **Check "members only" on the server, every single time.** A hidden button in the dining
  room is *not* security — anyone can call the API directly. Protected routes put a guard in
  front: `router.get("/me", requireAuth, handler)` (see `me.ts`), and organiser-only routes
  add `requireOrganiser`. The sign-in token is re-checked on every request; we never just
  trust what the browser claims to be.
- **Cook from the pantry, not from the supplier, on a page load.** Notion and Humanitix are
  synced into Postgres on a timer (that's the `content/` and `tickets/` folders). So if Notion
  is down, the site shrugs and serves the last good copy. A page must be fast and must never
  depend on someone else's API being up at that exact second.
- **Nothing is ever truly deleted.** "Deleting" flips a flag (`isArchived`, a `withdrawn`
  status); the row stays. And every meaningful action gets written to an append-only
  `audit_log`, so we can always answer "who changed this, and when?"
- **Some things are worked out, not stored.** A team's status (`forming` / `confirmed` / …)
  is *calculated* from its members and their tickets (`teams/status.ts`), never set by hand —
  so it can never drift out of step with reality.

The clearest example of this mindset is `tickets/sync.ts`. It has a **safety gate** that flat
-out refuses to un-verify a big chunk of attendees in a single sync — because the difference
between a normal bug and "200 people are locked out an hour before doors open" is enormous.
Have a read of the comments there someday; it's a lovely example of thinking about what happens
when things go wrong, which is most of what senior backend work actually is.

---

## 5. Running and poking at the kitchen

Setup is identical to Part 1 (`npm install`, `docker compose up -d db`, `npm run db:seed`,
`npm run dev`). The nice thing about the backend is you can talk to it directly from the
terminal — no browser needed — using `curl`, which is just "make a web request from the
command line":

```bash
curl http://localhost:3000/api/health         # {"status":"ok","db":"ok"}
curl http://localhost:3000/api/public/past     # {"events":[...]}
curl http://localhost:3000/api/public/stats    # your exercise — see §6
```

Poking one endpoint at a time like this is the fastest way to understand it in isolation. (For
routes that need sign-in it's easier to test through the running site with dev sign-in — but
you won't need auth for the exercise.)

**When the backend misbehaves, watch the terminal running `npm run dev`.** That's where server
errors and any `console.log` you add show up. (The *browser* console only shows dining-room
errors — a common early confusion. Frontend problems: browser console. Backend problems:
terminal.)

---

## 6. Exercise — build your first endpoint  (`src/server/routes/stats.ts`)

This is the mirror image of frontend Exercise 1: there you drew data the kitchen already sent;
here you build the kitchen end of a brand-new order. The file is already created, stubbed, and
wired into `index.ts`, so it's *live right now* —
`curl http://localhost:3000/api/public/stats` returns `{"pastEventCount":0}`. Your job is to
make that number honest.

**Goal:** make `GET /api/public/stats` return the real number of past events.

**A gentle way in:**
1. Open `src/server/routes/public.ts` and find the `/public/past` handler. It already asks the
   pantry for exactly the rows you care about (published **and** archived events). You're going
   to reuse that same `.where(...)` filter.
2. In `stats.ts`, run that query and return the *count* rather than the list. The simplest
   version: fetch the rows and return `rows.length`. (Uncomment the imports at the top of the
   file as you reach for them.)
3. No restart needed — `npm run dev` reloads on save. Re-run the `curl` and watch the number
   change. That instant feedback loop is the fun part.

**You'll know it worked:** after `npm run db:seed` there are 2 past events, so a correct
version returns `{"pastEventCount":2}` instead of `0`.

**And here's the whole point** — go back to the dining room and finish the circle: add an
`api.stats()` function to `web/src/api.ts` (the waiter learns a new order) and show
"N hackathons and counting" somewhere on your redesigned landing page. That's one small
feature you built through *every* layer — pantry, kitchen, waiter, dining room. Once you've
done that, none of this is magic anymore. 🎉

> Want more? Stretch goal: also return `publishedEventCount` (published but not archived). And
> if you'd like to see the full "add a new column" ritual from §3 for real, grab me — it's a
> great next exercise.

---

## 7. What to leave alone for now

While you're finding your feet, steer clear of these unless we're pairing on it. They have
sharp edges and real-world consequences:

- **`tickets/sync.ts` and the safety gate** — get this wrong and real people get locked out.
- **`auth/`** — we never build authentication; mac-auth owns it entirely.
- **Anything that writes to `audit_log`, or that hard-deletes a row** — please don't add hard
  deletes; it breaks a promise the whole system relies on.
- **`db/schema.ts` migrations against production data.**

Adding **read-only** endpoints — exactly like the stats exercise — is always safe. That's the
corner of the kitchen to play in first.

---

That's the whole machine, both halves. You came in as "the frontend person" and now you can
read a request from the button a guest clicks all the way down to the pantry shelf and back.
That's genuinely full-stack — well done.

Any question, however small, come find me. Welcome to the kitchen. 🚀
