# Frontend guide & handover

Welcome! 👋 You're taking over the **frontend** of the MAC Hackathon platform — the part
people actually see and click. This doc teaches you how the whole thing fits together (so
the frontend makes sense, not just "magic that works"), how to run it on your laptop, and
gives you **two hands-on exercises** to get your hands dirty before you start redesigning.

You don't need to touch the backend to redesign the frontend. But you *should* understand
how they talk, because every screen you build is really "fetch some data, then draw it."

> New to git? There's a **Git cheat-sheet** at the bottom. Read that first if you've never
> made a branch or a pull request.

---

## 1. The big picture: where does the data come from?

The most important thing to understand: **the website does not invent its own data.** Every
screen is drawing numbers and text that came from somewhere else. There are three sources:

```
   Notion (a fancy doc)          Humanitix (ticket sales)        Organisers (admin panel)
   prizes, judges, FAQ,          who bought a ticket             create the event,
   schedule, sponsors…           for the hackathon               trigger syncs
        │                              │                              │
        │  (synced on a timer)         │  (synced on a timer)         │  (saved directly)
        ▼                              ▼                              ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │                          Postgres  (our database)                       │
   │      one place that holds a *copy* of everything, always fast           │
   └───────────────────────────────────────────────────────────────────────┘
        │
        │   the backend reads Postgres and hands out JSON
        ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │              Backend API  (Express, in src/server/)                     │
   │   e.g.  GET /api/public/event   →   { event: {...}, content: {...} }    │
   └───────────────────────────────────────────────────────────────────────┘
        │
        │   the frontend fetches that JSON
        ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │        Frontend  (React, in web/)  ← THIS IS YOUR PATCH                 │
   │        turns JSON into buttons, cards, and text on the page             │
   └───────────────────────────────────────────────────────────────────────┘
```

**A common misconception to clear up:** the public info (prizes, judges, schedule…) comes
from **Notion**, not from the admin panel. The admin panel just lets organisers create the
event and press "sync now." The content itself lives in a Notion database, gets copied into
Postgres on a timer, and the website reads it from Postgres. (Why the copy? So the site
stays up and fast even if Notion is slow or down.) Ticket info works the same way, but the
source is Humanitix.

You almost never care *which* original source something came from. By the time it reaches
your React code, it's just JSON from our own API.

---

## 2. The request lifecycle (the loop you'll repeat all day)

Every interactive screen is the same four steps. Learn this once and every page makes sense:

```
1. React page loads  ──▶  2. calls a function in web/src/api.ts
                                  │
                                  ▼
                          3. that does fetch("/api/…") to the backend
                                  │
                                  ▼  backend reads Postgres, returns JSON
4. React stores the JSON in state and renders it  ◀──────────────────┘
```

If the user *changes* something (joins a team, ticks a box), it's the same loop with one
extra step: send the change (a `POST`/`PATCH`), then **re-fetch** so the screen matches the
new reality. You'll do exactly this in Exercise 2.

**You should never write `fetch("/api/…")` directly in a page.** All the network calls live
in one file — `web/src/api.ts` — as tidy named functions like `api.pastEvents()`. Your pages
call those. This keeps auth, error handling, and URLs in one place. If you need a new call,
add it to `api.ts` first, then use it.

---

## 3. The frontend file map

Everything you own is under `web/`. You can mostly ignore `src/server/` (that's the backend).

```
web/
  index.html            the single HTML page everything mounts into
  src/
    main.tsx            ROUTER: which URL shows which page. Start here.
    api.ts              ALL calls to the backend live here (api.pastEvents(), etc.)
    auth.ts             sign-in / token plumbing — you rarely touch this
    format.ts           date/time helpers (fmtDateRange, fmtTime)
    styles.css          Tailwind theme + shared component classes (colours, buttons…)
    pages/
      Landing.tsx       public homepage  ✅ WORKS — read this as your example
      Dashboard.tsx     "am I in the hackathon?" page  ✅ WORKS — best example
      Admin.tsx         organiser control panel  ✅ WORKS
      Past.tsx          archive of old events    🚧 EXERCISE 1 (stubbed for you)
      FindTeam.tsx      the teammate pool         🚧 EXERCISE 2 (stubbed for you)
    components/
      SignInPanel.tsx   "please sign in" box
      ClaimForm.tsx     ticket-claiming form
      CustomFieldsForm.tsx  extra event questions
```

The two 🚧 files have been **deliberately emptied out into guided stubs** so you can rebuild
them yourself — that's how you'll learn the fetch-then-render loop. The ✅ pages are complete
and are your reference: whenever you're stuck, open `Landing.tsx` or `Dashboard.tsx` and see
how they did it.

---

## 4. Running it on your laptop

You need [Node 22](https://nodejs.org) and [Docker Desktop](https://www.docker.com/products/docker-desktop/)
installed. Then:

```bash
npm install                    # once, to grab dependencies
cp .env.example .env           # then open .env and set:
                               #   DATABASE_URL=...@localhost:5433/mac_hackathon
                               #   DEV_AUTH=1
docker compose up -d db        # starts just the Postgres database (in Docker)
npm run db:migrate             # creates the database tables
npm run dev                    # starts backend (:3000) + frontend (:5173)
```

Then open **http://localhost:5173** in your browser. That's the Vite dev server — it
**hot-reloads**, meaning when you save a `.tsx` file the page updates instantly. This is
where you'll do all your work.

**Signing in locally.** Real sign-in only works on the live `monashcoding.com` site. On your
laptop, because you set `DEV_AUTH=1`, there's a **fake dev sign-in**: a panel lets you type
any name/email and tick an "organiser" box, and it just works. This is only ever on in dev —
it can't be turned on in production.

**Two useful checks if something looks broken:**
- Open the browser DevTools (F12) → **Console** tab for React errors, and **Network** tab to
  watch the `/api/...` calls and see what JSON came back. This is your #1 debugging tool.
- `http://localhost:3000/api/health` should say `{"status":"ok"}` — that confirms the
  backend is alive.

If your local DB has no events/content in it, pages will look empty — that's expected, not a
bug. Ask Oliver for a way to seed some sample data, or just build against the empty/loading
states first.

---

## 5. Styling: Tailwind v4

We use **Tailwind CSS**. Instead of writing a separate `.css` file per component, you put
utility classes right on the element:

```tsx
<div className="rounded-lg border border-border bg-panel p-4">…</div>
//              ^rounded ^a border  ^our colour  ^our bg  ^padding
```

Our brand colours are defined once in `web/src/styles.css` as tokens you can use anywhere:
`bg-bg`, `bg-panel`, `text-text`, `text-muted`, `text-accent`, `border-border`,
`text-danger`, `text-ok`. So `text-accent` = our blue, `bg-panel` = the card background, etc.

That same file also defines a few **shortcut classes** built from those utilities, so common
things stay consistent: `.wrap` (centered page column), `.panel` (a card), `.muted` (grey
sub-text), `.topnav`, `.btn`, `.card`. You'll see these all over the existing pages. You're
free to redesign these — since it's your job to make it look good — but they're a comfortable
starting point.

New to Tailwind? The [official docs](https://tailwindcss.com/docs) have a search box; type
what you want ("padding", "flex", "rounded") and it shows the class.

---

## 6. Your two exercises

Do these **before** the big redesign. They're small, and they teach you the whole data loop
on the real codebase. Both files are already stubbed with detailed comments — open them.

### Exercise 1: the Past Events page  (`web/src/pages/Past.tsx`)

**Goal:** a read-only page listing past hackathons.

The data call already exists: `api.pastEvents()` returns `{ events: [...] }` (or `null` if
none). Your job is the React: fetch on load, show "Loading…", then map over the events and
draw each one (name, dates via `fmtDateRange`, venue, tagline, Devpost link).

**How to approach it:**
1. Open `web/src/pages/Landing.tsx`. Notice the shape: a `useState` to hold the data, a
   `useEffect` that calls the API once on load, and JSX that renders it. That's the whole
   trick — you're copying that shape.
2. Look at what `api.pastEvents()` returns and what fields a `PublicEvent` has (both are in
   `web/src/api.ts` — hover the types in your editor).
3. Build it. Handle three states: still loading, loaded-but-empty, and loaded-with-events.

You'll know it works when you can add a past event (ask Oliver / use the admin panel) and it
shows up on `/past`.

### Exercise 2: the Find-a-Team page  (`web/src/pages/FindTeam.tsx`)

**Goal:** a page that both reads *and* writes. Harder — this is the real skill.

It shows a pool of people looking for a team, lets you tick "I'm looking for a team" (which
saves to the server), and — if you lead a team with a spare seat — lets you invite someone.

**How to approach it:**
1. This time read `web/src/pages/Dashboard.tsx` as your model — it does the full
   **load → let the user act → send the change → re-fetch** cycle.
2. The calls you need are already in `api.ts`: `api.findTeam()` (load), `api.updateProfile(...)`
   (opt in/out), `api.inviteFromPool(...)` (invite). The stub comment lists them.
3. Two things that trip people up, and how the reference page handles them:
   - **Signed out?** `api.findTeam()` throws a `NotSignedInError`. Catch it and show
     `<SignInPanel/>` instead of crashing.
   - **After a write, always re-fetch.** Don't try to hand-edit local state to match — just
     call your load function again. It's simpler and always correct.

You'll know it works when ticking the box and reloading keeps the box ticked (it saved), and
the pool list updates after you invite someone.

> **Stuck? The original, working versions of both files exist** in git on the
> `mac-hackathon-mvp` branch. Try it yourself first — but if you want to peek at a solution:
> `git show mac-hackathon-mvp:web/src/pages/Past.tsx`. Learning to read someone else's
> solution *after* attempting it is a real skill; use it that way.

---

## 7. Then: the redesign

Once those two work, you understand the whole frontend. Now make it beautiful. Suggested
order:
1. Start with `Landing.tsx` (the public homepage — most eyes on it, most fun to design).
2. Then `Dashboard.tsx` — but be careful: read the top comment in that file. It's the single
   most important page (a participant must never leave it unsure whether they're in the
   hackathon). Redesign the *look*, keep every piece of *information* it shows.
3. Keep it mobile-friendly — lots of people open this on their phone.

Design freely, but keep the data each page shows intact — you're changing how it looks, not
what it says. If you find you need data that isn't there, that's a backend change: write it
down and talk to Oliver rather than faking it in the frontend.

---

## 8. Git cheat-sheet (if you're new to this)

You're on a branch called `frontend-redesign` — your own copy where you can't break anyone
else's work. The normal loop:

```bash
git status                       # what have I changed?
git add -A                       # stage all my changes
git commit -m "Rebuild Past page"   # save a snapshot, with a message
git push                         # upload your branch to GitHub
```

Commit **little and often** — every time something works, commit it. Good messages describe
what you did ("Add loading state to Find a Team"), not "stuff" or "wip".

When a chunk of work is ready for Oliver to look at, open a **Pull Request** (PR) on GitHub
from your branch — that's how you ask "please review and merge my changes." Don't commit
straight to `main`.

If you get into a mess, **don't panic and don't force anything** — stop and ask. Almost
nothing in git is truly unrecoverable, but the fixes are much easier before you try random
commands.

---

Any questions, ask Oliver. Have fun — this is a real thing real people will use. 🎉
