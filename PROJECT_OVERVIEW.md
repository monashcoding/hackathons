# Project overview — read this first 🗺️

Welcome to the MAC Hackathon platform! This is the **10-minute, no-typing** orientation:
what this website is, why it exists, how it works at a high level, the rules you must not
break, and — most importantly — **what you should actually do next**. Once you've read this,
the hands-on guides ([`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md) and
[`BACKEND_GUIDE.md`](./BACKEND_GUIDE.md)) take over and get you writing real code.

You don't need to memorise any of this. Just come away with the *shape* of the thing.

---

## 1. What is this website?

It's two things bolted together:

1. **A public info site** for a MAC hackathon — prizes, judges, schedule, sponsors, FAQ.
   A non-developer edits it in **Notion**, and it updates on the live site with no deploy.
2. **A team registration system** whose one defining feature is: **every registered
   participant is checked against a real, paid ticket** (bought on **Humanitix**, the
   ticketing site).

That second part is the whole point. Hold onto it.

### Why it exists — the two problems

Straight from the Hackathon Director:

- **"We don't know if these people actually exist until the very end."** Teams sign up
  without their whole team, or with people who never bought a ticket. Nobody notices the
  gaps until event day.
- **"People keep asking if they're even in the hackathon."** Someone buys a ticket, hears
  nothing back, and DMs the director to ask if they're registered.

Both have the *same* root cause: **the ticket and the team roster are two separate lists
with no link between them.** This website links them. The ticket becomes the source of
truth, and the team roster is forced to constantly reconcile against it. That's the entire
idea in one sentence.

### What this is NOT (so you don't build the wrong thing)

- ❌ **Not** project submissions or judging — that stays on **Devpost**.
- ❌ **Not** ticket sales or payments — that's **Humanitix**.
- ❌ **Not** an email system — MAC deliberately doesn't send email. Notifications happen
  **in-app** and via **Discord**.
- ❌ **Not** a general CMS — **Notion** is the CMS.

If you ever catch yourself building one of these, stop — it belongs somewhere else.

---

## 2. How it works, at a high level

The single most useful idea: **the website never makes up its own data.** Everything on the
screen came from somewhere else and travelled to the browser. There are three "somewhere
else"s:

```
   Notion               Humanitix              Organisers
   (the info: prizes,   (who bought a          (create the event and
    judges, schedule)    ticket)                press "sync now" in /admin)
        │                    │                       │
        │  copied on a       │  copied on a          │  saved directly
        │  timer             │  timer                │
        ▼                    ▼                       ▼
   ┌──────────────────────────────────────────────────────────┐
   │   OUR DATABASE (Postgres) — one fast, local copy of        │
   │   everything the site needs                                │
   └──────────────────────────────────────────────────────────┘
        │
        │  the backend reads the database and hands out JSON
        ▼
   ┌──────────────────────────────────────────────────────────┐
   │   THE WEBSITE (React) — turns JSON into pages people see    │
   └──────────────────────────────────────────────────────────┘
```

Why keep our own *copy* instead of asking Notion/Humanitix live on every page load? Speed,
and safety: if Notion is down, we can still serve the page from our copy. Keeping the copy
fresh (on a timer) is the backend's job — you'll meet it in Part 2.

**The takeaway:** by the time data reaches the React code you'll be editing, you don't care
where it started. It's just JSON.

### The three big ideas layered on top

1. **Verification.** A participant signs in (with their Monash account), and we match them
   to their Humanitix ticket — by email, or by them typing in their **order reference**
   (the short `7QVD6HEL`-style code from their confirmation email) plus surname. Once
   matched, they see an unambiguous **"you're registered"** state and stop DMing anyone.
2. **Teams.** Verified people form teams (2–4 people). A team lead can see, at any time,
   exactly which members haven't **accepted** the invite and which haven't **bought a
   ticket** — weeks early, not on the day.
3. **The organiser gap report.** The admin view lists every ticket-holder with no team,
   every team member with no ticket, and every unaccepted invite. This one screen is the
   thing the director used to rebuild by hand — it's *why this project exists*.

---

## 3. The pages

Two pages for participants, split by the question each one answers:

- **`/dashboard` → "Am I actually in the hackathon?"** Ticket state, the verify/claim flow,
  and personal details. Nothing else. If someone reads this page and still has to ask, the
  page has failed.
- **`/find-team` (the "Team" tab) → everything about teams.** Your team, who hasn't accepted
  or bought a ticket yet, invites, team questions, and the pool of people looking for a
  team. All of it is locked until you're verified.

Plus **`/admin`** for organisers — the team board and the gap report above. It's reachable
by URL but deliberately not shown in the nav.

---

## 4. The rules you must not break

These aren't style preferences — they're load-bearing. Most were learned the hard way.

- **Humanitix is read-only.** We only ever *read* ticket data. Never write to it.
- **No email, ever.** No SMTP, no "send a confirmation email". In-app state + Discord.
- **We never build auth.** Sign-in is handled by `mac-auth`, a separate MAC service. Don't
  reinvent it.
- **Everything must survive handover.** The committee changes every year. No personal
  accounts, no paid subscriptions that can lapse, and next year's team must be able to run
  the whole thing from a clean clone with one command — *without talking to whoever built
  it.* If a decision relies on someone *remembering* something, it's the wrong decision.
- **Nothing is truly deleted.** Things get marked as gone and preserved, so mistakes are
  recoverable.

The full, authoritative version of all of this lives in
**[`SPEC_hackathon.md`](./SPEC_hackathon.md)** — that document is the source of truth. You
don't need to read all 593 lines today, but know it's there when a "can I...?" question
comes up.

---

## 5. What YOU should do (your first week)

Here's the path. Don't skip steps — each one makes the next make sense.

1. **Read this page** (done! ✅) so you have the mental model.
2. **Get it running on your laptop.** Full instructions are in
   [`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md) §4 — it's a handful of copy-paste commands and
   a sample-data seed so the pages aren't blank.
3. **Do the two exercises** in the frontend guide (§6). Two pages —
   [`Past.tsx`](./web/src/pages/Past.tsx) and [`FindTeam.tsx`](./web/src/pages/FindTeam.tsx) —
   have been **deliberately hollowed out** for you to rebuild. This is where everything
   clicks from "reading about it" to "I did it." The finished versions of both pages exist
   on the `mac-hackathon-mvp` branch if you get stuck and want to peek *after* trying.
4. **Then start the redesign** (frontend guide §7) — make it look great. The golden rule:
   change how a page *looks*, not what it *says*. If a page is missing data you wish it had,
   that's a backend change — write it down and ask, don't fake it in the frontend.
5. **Curious about the other half?** [`BACKEND_GUIDE.md`](./BACKEND_GUIDE.md) (Part 2) walks
   the server side and has its own small exercise. Optional, but it demystifies the whole
   machine.

### A few practical notes

- **Where you'll live:** everything you own is under `web/`. You can ignore `src/server/`
  (the backend) until you're curious.
- **Your branch:** you're on `frontend-redesign` — your own safe copy. Commit little and
  often, push, and open a Pull Request when something's ready for review. Never commit
  straight to `main`. (Git cheat-sheet: frontend guide §8.)
- **Seeing your work live:** this branch auto-deploys to
  **[staging-hackathons.monashcoding.com](https://staging-hackathons.monashcoding.com)** — a
  throwaway preview with sample data, completely separate from the real site. Push, wait a
  minute, and your changes are there to show people.
- **When you're stuck:** that's normal and expected — reaching out early is the pro move,
  not the beginner one. No question is too small.

---

## 6. The map of docs

| File | What it's for |
|------|---------------|
| **`PROJECT_OVERVIEW.md`** (this file) | The 10-minute big picture. Start here. |
| [`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md) | Part 1 — how the frontend works + your two exercises. **Your main guide.** |
| [`BACKEND_GUIDE.md`](./BACKEND_GUIDE.md) | Part 2 — the server side, when you're curious. |
| [`SPEC_hackathon.md`](./SPEC_hackathon.md) | The full source-of-truth spec. Reference, not bedtime reading. |
| [`README.md`](./README.md) | Setup, deployment, and stack details for the whole repo. |

Welcome aboard — real people are going to use what you build. Have fun with it. 🎉
