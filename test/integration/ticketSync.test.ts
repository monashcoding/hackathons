import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/server/db/index.ts";
import { syncRuns, tickets, type Event } from "../../src/server/db/schema.ts";
import { runTicketSync } from "../../src/server/tickets/sync.ts";
import { cleanupEvent, makeEvent, makeParticipant, normalisedTicket, stubTicketSource } from "../helpers.ts";

let event: Event;
const ids = Array.from({ length: 10 }, (_, i) => `g${i}`);
const all = () => ids.map((id) => normalisedTicket({ humanitixTicketId: id, ticketTypeName: "General" }));

async function validCount() {
  const rows = await db.select().from(tickets).where(and(eq(tickets.eventId, event.id), eq(tickets.status, "complete")));
  return rows.length;
}

beforeEach(async () => {
  event = await makeEvent({ humanitixEventId: "stub-event" });
  const r = await runTicketSync(event, stubTicketSource(all()));
  expect(r.status).toBe("success");
  expect(await validCount()).toBe(10);
});
afterEach(() => cleanupEvent(event.id));

describe("mass-revocation safety gate", () => {
  it("aborts when a sweep would revoke more than the threshold", async () => {
    const r = await runTicketSync(event, stubTicketSource(all().slice(0, 7))); // drop 3 = 30%
    expect(r.status).toBe("aborted_safety");
    expect(r.wouldRevoke).toBe(3);
    expect(await validCount()).toBe(10); // nothing changed
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.eventId, event.id)).orderBy(syncRuns.startedAt);
    expect(run).toBeDefined();
  });

  it("aborts on a zero-result sweep while holding valid tickets", async () => {
    const r = await runTicketSync(event, stubTicketSource([]));
    expect(r.status).toBe("aborted_safety");
    expect(await validCount()).toBe(10);
  });

  it("applies a below-threshold sweep and cancels the vanished ticket", async () => {
    const r = await runTicketSync(event, stubTicketSource(all().slice(0, 9))); // drop 1 = 10%
    expect(r.status).toBe("success");
    expect(await validCount()).toBe(9);
    const cancelled = await db.select().from(tickets).where(and(eq(tickets.eventId, event.id), eq(tickets.status, "cancelled")));
    expect(cancelled.map((t) => t.humanitixTicketId)).toEqual(["g9"]);
  });

  it("force overrides the gate", async () => {
    const r = await runTicketSync(event, stubTicketSource(all().slice(0, 6)), { force: true }); // 40%
    expect(r.status).toBe("success");
    expect(await validCount()).toBe(6);
  });

  it("restores a ticket that returns complete", async () => {
    await runTicketSync(event, stubTicketSource(all().slice(0, 9)));
    const r = await runTicketSync(event, stubTicketSource(all()));
    expect(r.status).toBe("success");
    expect(await validCount()).toBe(10);
  });
});

describe("revocation of claimed tickets", () => {
  it("revokes the holder and releases the ticket when their ticket is cancelled", async () => {
    const [t] = await db.select().from(tickets).where(eq(tickets.eventId, event.id)).limit(1);
    const p = await makeParticipant(event, undefined, { verificationStatus: "verified" });
    await db.update(tickets).set({ claimedByParticipantId: p.id }).where(eq(tickets.id, t.id));

    // A sweep that drops this one ticket (10%) applies and revokes the holder.
    await runTicketSync(event, stubTicketSource(all().filter((x) => x.humanitixTicketId !== t.humanitixTicketId)));

    const [after] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(after.status).toBe("cancelled");
    expect(after.claimedByParticipantId).toBeNull();
  });
});
