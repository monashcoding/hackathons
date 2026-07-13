import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/server/db/index.ts";
import { tickets, type Event } from "../../src/server/db/schema.ts";
import { HumanitixTicketSource } from "../../src/server/tickets/humanitix.ts";
import { runTicketSync } from "../../src/server/tickets/sync.ts";
import { cleanupEvent, makeEvent } from "../helpers.ts";

// Opt-in: only runs when a real Humanitix key is present in the environment.
// Exercises the actual API path against the closed MACATHON 2026 event.
const MACATHON = "69c39e46e5da8174a38f4355";

describe.skipIf(!process.env.HUMANITIX_API_KEY)("Humanitix live sweep (MACATHON 2026)", () => {
  let event: Event;
  beforeEach(async () => {
    event = await makeEvent({
      humanitixEventId: MACATHON,
      participantTicketTypes: ["MAC Member", "Non-MAC Member"],
      mentorTicketTypes: [],
    });
  });
  afterEach(() => cleanupEvent(event.id));

  it("syncs all 141 tickets with emails joined from orders", async () => {
    const r = await runTicketSync(event, new HumanitixTicketSource());
    expect(r.status).toBe("success");
    expect(r.seen).toBe(141);

    const all = await db.select().from(tickets).where(eq(tickets.eventId, event.id));
    expect(all).toHaveLength(141);
    expect(all.every((t) => t.attendeeEmailNormalised)).toBe(true);
    expect(all.every((t) => t.orderReference && t.orderReference.length <= 12)).toBe(true);
    // ticketTypeName is trimmed on ingest (no trailing space)
    const types = new Set(all.map((t) => t.ticketTypeName));
    expect(types.has("Non-MAC Member")).toBe(true);
  });
});
