# Frontend guide — start here (Part 1 of 2)

> Haven't read **[`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md)** yet? Do that first (10 min,
> no typing) — it's the big-picture map. This guide is the hands-on follow-up.

Hey! 👋 Welcome to the MAC Hackathon platform. You're taking over the **frontend** — the part
people actually see, click, and (fingers crossed) enjoy using. This guide gets you from
"I've just cloned this repo" to "I understand how it works and I've changed real code," and
then turns you loose on the redesign.

You genuinely don't need to know the backend to make the frontend beautiful. But I don't want
any of this to feel like magic you're afraid to touch, so this guide explains the whole shape
of the thing, and its companion — **[`BACKEND_GUIDE.md`](./BACKEND_GUIDE.md)** (Part 2) — walks
the other half when you're curious. Read them in order; Part 2 literally picks up the story
where this one leaves off.

Here's the plan for your first day or two:
1. Read §1–§2 to get the mental model (10 minutes, no typing).
2. Get it running on your laptop (§4).
3. Do the two small **exercises** (§6) — this is where it clicks.
4. Start redesigning (§7).

> **Brand new to git?** Skip to the **cheat-sheet in §8** and read that first — it's the one
> tool you'll use constantly, and a little confidence there makes everything else calmer.

---

## 1. The big picture (a restaurant)

The single most useful thing to understand up front: **the website doesn't make up its own
data.** Every price, name, and date on the screen came from somewhere else and travelled to
the browser. Once you can picture that journey, every page makes sense.

The easiest way to hold it in your head is a restaurant:

- **The dining room** is the **frontend** (React, in `web/`) — the tables, the menus, the
  stuff guests see and touch. **This is your patch.**
- **The waiter** is one small file, **`web/src/api.ts`** — they carry your order to the
  kitchen and bring the food back. Guests don't wander into the kitchen themselves.
- **The kitchen** is the **backend** (Express, in `src/server/`) — it does the actual work.
  Guests never go in, but every dish comes from there.
- **The pantry** is the **database** (Postgres) — stocked shelves the kitchen cooks from.
  It's right there, so it's fast.
- **The suppliers** are **Notion** and **Humanitix** — they deliver fresh stock on a
  schedule. The kitchen keeps the pantry stocked so it never has to phone a supplier in the
  middle of dinner service.

Drawn out, a plate of data travels like this:

```
   Notion (a shared doc)         Humanitix (ticket sales)       Organisers (admin panel)
   prizes, judges, FAQ,          who bought a ticket            create the event,
   schedule, sponsors…           for the hackathon              press "sync now"
        │                              │                              │
        │  delivered on a timer        │  delivered on a timer        │  saved directly
        ▼                              ▼                              ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │              THE PANTRY — Postgres (our database)                       │
   │        one fast, local copy of everything the site needs                │
   └───────────────────────────────────────────────────────────────────────┘
        ▲
        │  the KITCHEN reads the pantry and plates up JSON
        │
   ┌───────────────────────────────────────────────────────────────────────┐
   │        THE KITCHEN — backend API (Express, src/server/)                 │
   │   e.g.  GET /api/public/event   →   { event: {…}, content: {…} }        │   ← Part 2
   └───────────────────────────────────────────────────────────────────────┘
        ▲
        │  the WAITER (web/src/api.ts) carries the order and brings JSON back
        │
   ┌───────────────────────────────────────────────────────────────────────┐
   │        THE DINING ROOM — frontend (React, web/)   ← YOU ARE HERE        │
   │        turns JSON into buttons, cards, and text on the page             │
   └───────────────────────────────────────────────────────────────────────┘
```

Why keep a *copy* in the pantry instead of asking Notion every time someone loads the page?
Same reason a kitchen keeps stock: it's faster, and if a supplier's truck is late (Notion is
down), you can still serve dinner from what's on the shelf. That "copy it on a schedule" job
is the backend's world — it's the whole second half of the story, so don't worry about it yet.

**The one thing to take away:** by the time data reaches your React code, you don't care
whether it started in Notion or Humanitix. It's just JSON, handed to you by the waiter.

---

## 2. The loop you'll repeat all day

Almost every screen you build is the same four steps. Learn this rhythm once and the rest is
detail:

```
1. A page loads  ──▶  2. it asks the waiter for data  (a function in web/src/api.ts)
                              │
                              ▼
                      3. the waiter fetches it from the kitchen  ( /api/… )
                              │
                              ▼   kitchen reads the pantry, returns JSON
4. the page saves that JSON and draws it on screen  ◀──────────────┘
```

When the user *changes* something — joins a team, ticks a box — it's the same loop with one
extra beat: **send the change, then ask for the data again** so the screen matches reality.
(That "ask again" habit saves you a world of confusing bugs. More on it in Exercise 2.)

**One rule that matters:** never call `fetch("/api/…")` straight from a page. All the kitchen
orders live in one place — **`web/src/api.ts`**, our waiter — as tidy named functions like
`api.pastEvents()`. Your pages call *those*. It keeps every network detail (the URL, the
sign-in token, error handling) in one file instead of scattered everywhere. Need something the
waiter doesn't offer yet? Add the function to `api.ts` first, then use it in your page.

> That `api.ts` file is exactly the seam where this guide hands off to Part 2: the waiter is
> the last thing on *your* side of the kitchen door. What happens after they push through it
> is the backend guide's job.

---

## 3. The files you'll live in

Everything you own is under `web/`. You can happily ignore `src/server/` for now — that's the
kitchen, and Part 2 gives you the tour.

```
web/
  index.html            the single HTML page everything loads into
  src/
    main.tsx            the ROUTER: which URL shows which page. A good first read.
    api.ts              the WAITER: every call to the backend lives here
    auth.ts             sign-in / token plumbing — you'll rarely touch this
    format.ts           date/time helpers (fmtDateRange, fmtTime)
    styles.css          Tailwind theme: our colours + shared classes (buttons, cards…)
    pages/
      Landing.tsx       public homepage        ✅ WORKS — your best worked example
      Dashboard.tsx     "am I in the hackathon?"  ✅ WORKS — the read-and-write example
      Admin.tsx         organiser control panel   ✅ WORKS
      Past.tsx          archive of old events     🚧 EXERCISE 1 (stubbed for you)
      FindTeam.tsx      the teammate pool         🚧 EXERCISE 2 (stubbed for you)
    components/
      TopNav.tsx           the shared top bar (Dashboard + Team tabs) on every page
      SignInPanel.tsx      the "please sign in" box
      ClaimForm.tsx        ticket-claiming form
      CustomFieldsForm.tsx extra event questions
      TeamPanels.tsx       the team views (your team, invites, the pool)
```

The two 🚧 pages have been **deliberately hollowed out into guided stubs** — you're going to
rebuild them, and that's how the whole loop from §2 stops being theory. The ✅ pages are
finished and working, and they're your safety net: whenever you're unsure how to do
something, open `Landing.tsx` or `Dashboard.tsx` and copy how *they* did it. Reading working
code is not cheating — it's most of the job.

---

## 4. Getting it running

You'll need [Node 22](https://nodejs.org) and
[Docker Desktop](https://www.docker.com/products/docker-desktop/) installed (Docker just runs
the pantry — the Postgres database — so you don't have to install it by hand). Then, from the
project folder:

```bash
npm install                    # once — downloads the project's dependencies
cp .env.example .env           # then open .env and set two things:
                               #   DATABASE_URL=...@localhost:5433/mac_hackathon
                               #   DEV_AUTH=1
docker compose up -d db        # start just the database (in Docker)
npm run db:migrate             # create the empty tables
npm run db:seed                # stock the pantry with sample data (see the note below)
npm run dev                    # start the kitchen (:3000) and the dining room (:5173)
```

Now open **http://localhost:5173**. That's the Vite dev server, and its superpower is
**hot reload**: save a `.tsx` file and the page updates in the browser instantly, no refresh.
This is where you'll spend all your time.

**A fresh database is empty**, so without that `npm run db:seed` step the pages look blank —
which is expected, not a bug you caused. The seed command stocks the pantry with realistic
sample data (one upcoming event, two past ones, plus prizes/judges/schedule/FAQ) so every
page has something to show and to restyle. It's safe to re-run any time.

**Signing in on your laptop.** Real sign-in only works on the live `monashcoding.com` site, so
locally there's a stand-in: because you set `DEV_AUTH=1`, a little dev sign-in panel lets you
type any name/email (and tick "organiser" if you want to see the admin pages). This shortcut
only exists in dev — it physically can't be switched on in production, so don't worry about
it leaking.

**Your two best friends when something looks broken:**
- **Browser DevTools** (press F12). The **Console** tab shows React errors in red; the
  **Network** tab lets you watch each `/api/…` call and click it to see exactly what JSON came
  back. When a page misbehaves, look here *first* — it usually tells you whether the problem
  is your React or the data it received.
- **http://localhost:3000/api/health** should say `{"status":"ok"}`. If it does, the kitchen
  is alive and the problem is on your side of the door.

---

## 5. Styling: Tailwind

We style with **Tailwind CSS**. Instead of writing a separate stylesheet, you put small
utility classes right on the element:

```tsx
<div className="rounded-lg border border-border bg-panel p-4">…</div>
//              ^rounded  ^a border      ^our bg colour  ^padding
```

Our brand colours live in one place — `web/src/styles.css` — as named tokens you can use
anywhere: `bg-bg`, `bg-panel`, `text-text`, `text-muted`, `text-accent`, `border-border`,
`text-danger`, `text-ok`. So `text-accent` is our MAC yellow, `bg-panel` is the card background, and
so on. Using the tokens (instead of hard-coding a colour) keeps the whole site consistent and
makes a future theme change a one-file edit.

That same file defines a few **shortcut classes** built from those utilities — `.wrap` (a
centered page column), `.panel` (a card), `.muted` (grey sub-text), `.topnav`, `.btn`,
`.card`. You'll spot them all over the existing pages. Redesigning them is fair game — making
it look good is literally your job — but they're a comfortable place to start.

New to Tailwind? The [docs](https://tailwindcss.com/docs) have a search box — type what you
want ("padding", "flex", "rounded corners") and it shows you the class. You'll memorise the
common ones within a week.

---

## 6. Your two exercises (do these before redesigning)

These are small on purpose. They walk you through the whole §2 loop on real code, so that by
the end you're not *reading* about how the app works — you've done it. Both files are already
open-able with detailed comments inside; this section is the friendly version.

### Exercise 1 — the Past Events page  (`web/src/pages/Past.tsx`)

**What you're building:** a read-only page that lists past hackathons. No writing data yet,
just fetching and drawing — the gentlest possible version of the loop.

The waiter already knows this order: `api.pastEvents()` hands you `{ events: [...] }` (or
`null` if there aren't any). Your job is the React around it: fetch when the page loads, show
a "Loading…" line while you wait, then map over the events and draw each one (name; dates via
the `fmtDateRange` helper; venue; tagline; a Devpost link if there is one).

**A gentle way in:**
1. Open `web/src/pages/Landing.tsx` and look at its shape — a `useState` to hold the data, a
   `useEffect` that calls the waiter once when the page loads, and some JSX that draws the
   result. That shape *is* the trick. You're copying it.
2. Peek at `api.pastEvents()` and the `PublicEvent` type in `web/src/api.ts` so you know what
   fields you're getting (hover them in your editor — the types tell you).
3. Build it, handling three moments: still loading, loaded-but-empty, and loaded-with-events.
   Real pages always think about all three.

**You'll know it worked** when the seeded past events show up at `/past` in your browser. 🎉

### Exercise 2 — the Find-a-Team page  (`web/src/pages/FindTeam.tsx`)

**What you're building:** a page that both *reads and writes*. This is the real skill, and
it's the boss level of the loop — take your time.

It shows a pool of people looking for a team, lets you tick "I'm looking for a team" (which
**saves** to the server), and — if you lead a team with a spare seat — lets you invite
someone from the pool.

**A gentle way in:**
1. This time, read `web/src/pages/Dashboard.tsx` as your model. It does the full dance:
   **load → let the user do something → send the change → ask for the data again.**
2. The waiter already has every order you need (they're listed in the stub's comments):
   `api.findTeam()` to load, `api.updateProfile(...)` to opt in/out, `api.inviteFromPool(...)`
   to invite.
3. Two things that trip everyone up the first time — and how the reference page handles them:
   - **Not signed in?** `api.findTeam()` throws a `NotSignedInError`. Catch it and show the
     `<SignInPanel/>` component instead of letting the page crash.
   - **After you save a change, re-fetch.** Resist the urge to hand-edit the on-screen data to
     match what you just sent. Just call your load function again and let fresh data redraw the
     page. It's less code and it's never wrong.

**You'll know it worked** when ticking the box and reloading keeps it ticked (proof it saved),
and the pool updates after you invite someone.

> **Stuck, and want to see how it's done?** The original working versions of both pages are
> still in git on the `mac-hackathon-mvp` branch. Have a real go first — struggling for a bit
> is where the learning happens — but when you want to check your thinking:
> `git show mac-hackathon-mvp:web/src/pages/Past.tsx`. Reading a solution *after* you've
> attempted it is a genuine skill; that's the way to use it.
>
> **Curious what happens after the waiter disappears into the kitchen?** That exact question
> is Part 2 — **[`BACKEND_GUIDE.md`](./BACKEND_GUIDE.md)** — and it has a matching little
> exercise that builds the *other* end of an `api.…` call.

---

## 7. The redesign

Once those two work, you understand the frontend — really. Now go make it lovely. A sensible
order:

1. **`Landing.tsx`** first — the public homepage. Most eyes land here, and it's the most fun
   to design.
2. **`Dashboard.tsx`** next — but read the comment at the top of that file before you start.
   It's the most important page in the whole app: a participant should never leave it unsure
   whether they're actually in the hackathon. Restyle the *look* all you like; keep every
   piece of *information* it currently shows.
3. Design **mobile-first** — a lot of people open this on their phone between classes.

The golden rule: change how a page *looks*, not what it *says*. If you find yourself wanting
data that isn't there, that's a backend change — jot it down and talk to me rather than faking
it in the frontend. (And if you're curious how you'd add it yourself, that's Part 2. 😉)

---

## 8. Git cheat-sheet (if this is new)

You're working on a branch called `frontend-redesign` — think of it as your own copy of the
project where you can experiment freely without breaking anyone else's work. The everyday
rhythm:

```bash
git status                          # what have I changed?
git add -A                          # stage all my changes, ready to save
git commit -m "Rebuild Past page"   # save a snapshot, with a short message
git push                            # upload your branch to GitHub
```

**Commit little and often** — every time something works, save it. Future-you will thank
present-you. Good messages say what you did ("Add loading state to Find a Team"), not "stuff"
or "wip".

When a piece of work is ready for me to look at, open a **Pull Request** on GitHub from your
branch — that's the "hey, please review this" button. Don't commit straight to the main
branch.

And if you ever end up in a tangle: **stop, don't force anything, and ask.** Almost nothing in
git is truly unrecoverable, but the fixes are far easier *before* trying random commands you
found online. Getting stuck is completely normal — reaching out early is the pro move, not the
beginner one.

---

That's everything you need to start. When you're comfortable here and want to see the other
half of the machine, **[`BACKEND_GUIDE.md`](./BACKEND_GUIDE.md)** is waiting.

Any questions at all, ask me — no question is too small. Have fun with it; real people are
going to use what you build. 🎉
