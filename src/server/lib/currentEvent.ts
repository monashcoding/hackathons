import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { events, type Event } from "../db/schema.ts";

// The current/next event participants register for and the public site shows:
// the newest published, non-archived event. Single source of truth so the
// dashboard, claim flow, and public pages all agree on "which hackathon".
export async function getCurrentEvent(): Promise<Event | null> {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.isPublished, true), eq(events.isArchived, false)))
    .orderBy(desc(events.startsAt))
    .limit(1);
  return row ?? null;
}
