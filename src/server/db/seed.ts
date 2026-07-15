// ---------------------------------------------------------------------------
// Dev seed — fills an empty local database with a realistic-looking event so the
// public site, past-events page, and dashboard aren't blank while you work on
// the frontend.
//
//   npm run db:seed
//
// DEV ONLY. It writes plausible fake data, never touches Notion/Humanitix, and
// is safe to run repeatedly — it upserts by a stable key (event slug / a fake
// "notion page id"), so re-running just refreshes the same rows rather than
// piling up duplicates. It refuses to run when NODE_ENV=production.
//
// This is NOT how real content gets in — that comes from Notion via the sync
// (see BACKEND_GUIDE.md §4). This is scaffolding so you have something to style.
// ---------------------------------------------------------------------------
import { db, closeDb } from "./index.ts";
import { contentBlocks, events } from "./schema.ts";
import { isProduction } from "../env.ts";

async function upsertEvent(row: typeof events.$inferInsert) {
  const [saved] = await db
    .insert(events)
    .values(row)
    .onConflictDoUpdate({ target: events.slug, set: row })
    .returning();
  return saved!;
}

async function upsertBlock(row: typeof contentBlocks.$inferInsert) {
  await db
    .insert(contentBlocks)
    .values(row)
    .onConflictDoUpdate({ target: contentBlocks.notionPageId, set: row });
}

async function main() {
  if (isProduction) {
    throw new Error("Refusing to seed: NODE_ENV=production. The seed is dev-only.");
  }

  // --- The current event (published, not archived → this is what the landing
  //     page and dashboard show). Dates are in the near future. ---
  const current = await upsertEvent({
    slug: "2026",
    name: "MACATHON 2026",
    tagline: "48 hours. One idea. Build something that matters.",
    startsAt: new Date("2026-09-19T09:00:00+10:00"),
    endsAt: new Date("2026-09-21T17:00:00+10:00"),
    venue: "Monash University, Clayton",
    registrationOpensAt: new Date("2026-08-01T00:00:00+10:00"),
    registrationClosesAt: new Date("2026-09-15T23:59:00+10:00"),
    minTeamSize: 2,
    maxTeamSize: 4,
    devpostUrl: "https://macathon-2026.devpost.com",
    isPublished: true,
    isArchived: false,
  });

  // --- Past events (published AND archived → these show on /past). ---
  await upsertEvent({
    slug: "2025",
    name: "MACATHON 2025",
    tagline: "Where it all came together.",
    startsAt: new Date("2025-09-20T09:00:00+10:00"),
    endsAt: new Date("2025-09-22T17:00:00+10:00"),
    venue: "Monash University, Clayton",
    minTeamSize: 2,
    maxTeamSize: 4,
    devpostUrl: "https://macathon-2025.devpost.com",
    isPublished: true,
    isArchived: true,
  });
  await upsertEvent({
    slug: "2024",
    name: "MACATHON 2024",
    tagline: "The one that started the streak.",
    startsAt: new Date("2024-09-21T09:00:00+10:00"),
    endsAt: new Date("2024-09-23T17:00:00+10:00"),
    venue: "Monash University, Caulfield",
    minTeamSize: 2,
    maxTeamSize: 4,
    isPublished: true,
    isArchived: true,
  });

  // --- Content for the current event. In production these rows come from Notion
  //     via the sync; here we fake a handful so every section on the landing
  //     page has something to render. `payload` matches the ContentItem shape
  //     the frontend expects (see web/src/api.ts). ---
  const blocks: Array<{
    kind: (typeof contentBlocks.$inferInsert)["kind"];
    id: string;
    sort: number;
    payload: Record<string, unknown>;
  }> = [
    { kind: "prize", id: "seed-prize-1", sort: 0, payload: { title: "Best Overall", subtitle: "$2,000 + interviews", bodyHtml: "<p>The team that best nails idea, execution, and demo.</p>" } },
    { kind: "prize", id: "seed-prize-2", sort: 1, payload: { title: "Best Use of AI", subtitle: "$1,000", bodyHtml: "<p>Most thoughtful application of AI to a real problem.</p>" } },
    { kind: "prize", id: "seed-prize-3", sort: 2, payload: { title: "People's Choice", subtitle: "$500", bodyHtml: "<p>Voted by fellow hackers at the expo.</p>" } },

    { kind: "judge", id: "seed-judge-1", sort: 0, payload: { title: "Dr Alex Chen", subtitle: "Senior Engineer, Atlassian", bodyHtml: "<p>Distributed systems and developer tools.</p>" } },
    { kind: "judge", id: "seed-judge-2", sort: 1, payload: { title: "Priya Nair", subtitle: "Founder, Northlight AI", bodyHtml: "<p>Building applied ML products.</p>" } },

    { kind: "schedule_item", id: "seed-sched-1", sort: 0, payload: { title: "Doors open & check-in", time: "2026-09-19T09:00:00+10:00" } },
    { kind: "schedule_item", id: "seed-sched-2", sort: 1, payload: { title: "Opening ceremony & team forming", time: "2026-09-19T10:00:00+10:00" } },
    { kind: "schedule_item", id: "seed-sched-3", sort: 2, payload: { title: "Hacking begins", time: "2026-09-19T12:00:00+10:00" } },
    { kind: "schedule_item", id: "seed-sched-4", sort: 3, payload: { title: "Submissions due & expo", time: "2026-09-21T12:00:00+10:00" } },

    { kind: "sponsor", id: "seed-sponsor-1", sort: 0, payload: { title: "Atlassian", subtitle: "Platinum sponsor", url: "https://atlassian.com" } },
    { kind: "sponsor", id: "seed-sponsor-2", sort: 1, payload: { title: "AWS", subtitle: "Cloud credits", url: "https://aws.amazon.com" } },

    { kind: "faq", id: "seed-faq-1", sort: 0, payload: { question: "Do I need a team to sign up?", answerHtml: "<p>No — come solo and use the Find a Team page. Teams are 2–4 people.</p>" } },
    { kind: "faq", id: "seed-faq-2", sort: 1, payload: { question: "How much does it cost?", answerHtml: "<p>A small ticket via Humanitix, which covers food for the whole weekend.</p>" } },
    { kind: "faq", id: "seed-faq-3", sort: 2, payload: { question: "Who can attend?", answerHtml: "<p>Anyone, from any university. All skill levels welcome.</p>" } },
  ];

  for (const b of blocks) {
    await upsertBlock({
      eventId: current.id,
      kind: b.kind,
      notionPageId: b.id,
      payload: b.payload,
      sortOrder: b.sort,
      isPublished: true,
      isPresent: true,
    });
  }

  console.log(
    `[seed] done — current event "${current.name}", 2 past events, ${blocks.length} content blocks.`,
  );
  console.log("[seed] open http://localhost:5173 (landing) and /past to see it.");
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error("[seed] failed:", err);
    await closeDb();
    process.exit(1);
  });
