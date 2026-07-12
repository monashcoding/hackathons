import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { events, type Event } from "../db/schema.ts";
import { env } from "../env.ts";
import { HumanitixTicketSource } from "./humanitix.ts";
import { runTicketSync } from "./sync.ts";

// Cadence (spec §6): every 10 minutes while registration is open or the event
// is running (walk-up + on-the-day sales are real), every 60 minutes otherwise.
// We tick every 10 minutes and decide per event whether it's due — the top-of-
// hour tick (minute 0) is the "hourly" one.
export function startTicketCron(): void {
  if (!env.humanitix.apiKey) {
    console.log("[ticket-cron] Humanitix not configured — cron not scheduled.");
    return;
  }

  cron.schedule("*/10 * * * *", () => {
    void tick().catch((err) => console.error("[ticket-cron] tick failed:", (err as Error).message));
  });
  console.log("[ticket-cron] scheduled ticket sync (10-min ticks, per-event cadence).");
}

async function tick(): Promise<void> {
  const now = new Date();
  const isTopOfHour = now.getMinutes() < 10; // the hourly slot

  const rows = await db.select().from(events).where(eq(events.isArchived, false));
  const source = new HumanitixTicketSource();
  for (const event of rows) {
    if (!event.humanitixEventId) continue;
    const active = isActiveWindow(event, now);
    if (!active && !isTopOfHour) continue; // idle events sync only hourly
    await runTicketSync(event, source).catch((err) =>
      console.error(`[ticket-cron] ${event.slug} threw:`, (err as Error).message),
    );
  }
}

// "Active" = registration is open, or the event itself is running. Windows are
// evaluated server-side against UTC; client time is never trusted.
export function isActiveWindow(event: Event, now: Date): boolean {
  const within = (start: Date | null, end: Date | null) =>
    start !== null && end !== null && now >= start && now <= end;
  return (
    within(event.registrationOpensAt, event.registrationClosesAt) ||
    within(event.startsAt, event.endsAt)
  );
}
