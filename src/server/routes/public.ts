import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { contentBlocks, events, type ContentBlock, type Event } from "../db/schema.ts";
import { getCurrentEvent } from "../lib/currentEvent.ts";

export const publicRouter = Router();

// Public event shape — a deliberate whitelist. Internal fields (humanitix id,
// ticket-type mapping) never reach a public JSON response.
function toPublicEvent(e: Event) {
  return {
    slug: e.slug,
    name: e.name,
    tagline: e.tagline,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    venue: e.venue,
    registrationOpensAt: e.registrationOpensAt,
    registrationClosesAt: e.registrationClosesAt,
    minTeamSize: e.minTeamSize,
    maxTeamSize: e.maxTeamSize,
    devpostUrl: e.devpostUrl,
    ticketUrl: e.ticketUrl,
    coverImageUrl: e.coverImageUrl,
    discordUrl: e.discordUrl,
  };
}

// Group published, present blocks by kind, sorted for display. Only the
// render-ready payload is exposed.
async function contentForEvent(eventId: string) {
  const rows = await db
    .select()
    .from(contentBlocks)
    .where(
      and(
        eq(contentBlocks.eventId, eventId),
        eq(contentBlocks.isPublished, true),
        eq(contentBlocks.isPresent, true),
      ),
    );

  rows.sort((a, b) => a.sortOrder - b.sortOrder || title(a).localeCompare(title(b)));

  const grouped: Record<string, unknown[]> = {
    prize: [],
    judge: [],
    schedule_item: [],
    sponsor: [],
    faq: [],
    page: [],
  };
  for (const r of rows) grouped[r.kind]?.push(r.payload);
  return grouped;
}

function title(b: ContentBlock): string {
  const t = (b.payload as { title?: unknown }).title;
  return typeof t === "string" ? t : "";
}

// GET /api/public/event — current/next event + its content. 204 when nothing is
// published yet (the SPA shows a friendly placeholder). Served from Postgres —
// never a live Notion proxy. If Notion is down the site is unaffected.
publicRouter.get("/public/event", async (_req, res) => {
  const event = await getCurrentEvent();
  if (!event) {
    res.status(204).end();
    return;
  }
  res.json({ event: toPublicEvent(event), content: await contentForEvent(event.id) });
});

// GET /api/public/past — archive of previous events. Every year this gets better
// and it costs nothing.
publicRouter.get("/public/past", async (_req, res) => {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.isPublished, true), eq(events.isArchived, true)))
    .orderBy(desc(events.startsAt));
  res.json({ events: rows.map(toPublicEvent) });
});
