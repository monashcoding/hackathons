import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/server/db/index.ts";
import {
  auditLog,
  customFieldResponses,
  customFields,
  events,
  invites,
  participants,
  syncRuns,
  teamMembers,
  teams,
  tickets,
  type Event,
  type NewTicket,
  type Participant,
} from "../src/server/db/schema.ts";
import type { MacUser } from "../src/server/auth/jwt.ts";
import type { NormalisedTicket, TicketSource } from "../src/server/tickets/types.ts";

// A short unique slug so parallel/sequential test events never collide.
export function uniqueSlug(prefix = "t"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function makeEvent(overrides: Partial<typeof events.$inferInsert> = {}): Promise<Event> {
  const [row] = await db
    .insert(events)
    .values({
      slug: uniqueSlug("evt"),
      name: "Test Event",
      minTeamSize: 2,
      maxTeamSize: 4,
      participantTicketTypes: ["General"],
      mentorTicketTypes: ["Mentor"],
      ...overrides,
    })
    .returning();
  return row;
}

export async function makeParticipant(
  event: Event,
  macUserId = uniqueSlug("user"),
  overrides: Partial<typeof participants.$inferInsert> = {},
): Promise<Participant> {
  const [row] = await db
    .insert(participants)
    .values({ eventId: event.id, macUserId, displayName: macUserId, ...overrides })
    .returning();
  return row;
}

export async function makeTicket(event: Event, overrides: Partial<NewTicket> = {}) {
  const [row] = await db
    .insert(tickets)
    .values({
      eventId: event.id,
      humanitixTicketId: uniqueSlug("tkt"),
      ticketTypeName: "General",
      status: "complete",
      ...overrides,
    })
    .returning();
  return row;
}

export function fakeUser(macUserId: string, email: string | null = null, roles: string[] = []): MacUser {
  return { macUserId, email, emailNormalised: email, name: macUserId, roles, team: null, raw: {} };
}

export function stubTicketSource(list: NormalisedTicket[]): TicketSource {
  return { name: "stub", fetchTickets: async () => list };
}

export function normalisedTicket(overrides: Partial<NormalisedTicket> = {}): NormalisedTicket {
  const id = overrides.humanitixTicketId ?? uniqueSlug("ht");
  return {
    humanitixTicketId: id,
    humanitixOrderId: `order-${id}`,
    orderReference: `REF${id.slice(-6).toUpperCase()}`,
    ticketTypeName: "General",
    attendeeFirstName: "Test",
    attendeeLastName: "User",
    attendeeEmailNormalised: `${id}@example.com`,
    status: "complete",
    raw: {},
    ...overrides,
  };
}

// Delete an event and everything referencing it, FK-safe. Tests call this in
// afterEach so the shared test DB stays clean between cases.
export async function cleanupEvent(eventId: string): Promise<void> {
  const fieldRows = await db.select({ id: customFields.id }).from(customFields).where(eq(customFields.eventId, eventId));
  const fieldIds = fieldRows.map((f) => f.id);
  if (fieldIds.length > 0) {
    await db.delete(customFieldResponses).where(inArray(customFieldResponses.customFieldId, fieldIds));
  }
  const teamRows = await db.select({ id: teams.id }).from(teams).where(eq(teams.eventId, eventId));
  for (const t of teamRows) {
    await db.delete(invites).where(eq(invites.teamId, t.id));
    await db.delete(teamMembers).where(eq(teamMembers.teamId, t.id));
  }
  await db.delete(teams).where(eq(teams.eventId, eventId));
  await db.delete(customFields).where(eq(customFields.eventId, eventId));
  await db.delete(tickets).where(eq(tickets.eventId, eventId));
  await db.delete(syncRuns).where(eq(syncRuns.eventId, eventId));
  await db.delete(auditLog).where(eq(auditLog.eventId, eventId));
  await db.delete(participants).where(eq(participants.eventId, eventId));
  await db.delete(events).where(eq(events.id, eventId));
}
