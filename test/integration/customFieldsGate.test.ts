import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/server/db/index.ts";
import { customFields, type Event, type Participant, type Team } from "../../src/server/db/schema.ts";
import * as T from "../../src/server/teams/service.ts";
import * as CF from "../../src/server/customfields/service.ts";
import { cleanupEvent, makeEvent, makeParticipant } from "../helpers.ts";

let event: Event;
let lead: Participant;
let member: Participant;
let team: Team;

const confirm = () => T.setTeamStatus(team, lead, "confirmed");

beforeEach(async () => {
  event = await makeEvent({ minTeamSize: 2, maxTeamSize: 3 });
  lead = await makeParticipant(event, undefined, { verificationStatus: "verified" });
  member = await makeParticipant(event, undefined, { verificationStatus: "verified" });
  team = await T.createTeam(event, lead, "Squad");
  await T.joinByCode(event, member, team.inviteCode);
  // With no required fields, the lead can confirm freely.
  expect(await confirm()).toBe("confirmed");
});
afterEach(() => cleanupEvent(event.id));

// Required custom fields don't derive status any more (the lead owns that), but
// they DO block the lead from confirming until they're answered (§7).
describe("required custom fields gate confirmation (§7)", () => {
  it("a required participant field blocks confirmation until every member answers", async () => {
    const [f] = await db.insert(customFields).values({ eventId: event.id, label: "Dietary", type: "text", required: true, appliesTo: "participant" }).returning();
    await expect(confirm()).rejects.toMatchObject({ code: "fields_incomplete" });
    await CF.upsertParticipantResponses(event, lead.id, { [f.id]: "Vegan" });
    await expect(confirm()).rejects.toMatchObject({ code: "fields_incomplete" });
    await CF.upsertParticipantResponses(event, member.id, { [f.id]: "None" });
    expect(await confirm()).toBe("confirmed");
  });

  it("a required team field is answered by the lead, and invalid options are rejected", async () => {
    const [f] = await db.insert(customFields).values({ eventId: event.id, label: "Track", type: "select", options: ["AI", "Web"], required: true, appliesTo: "team" }).returning();
    await expect(confirm()).rejects.toMatchObject({ code: "fields_incomplete" });
    await expect(CF.upsertTeamResponses(event, team.id, { [f.id]: "Games" })).rejects.toThrow();
    await CF.upsertTeamResponses(event, team.id, { [f.id]: "AI" });
    expect(await confirm()).toBe("confirmed");
  });

  it("archiving a required field unblocks", async () => {
    const [f] = await db.insert(customFields).values({ eventId: event.id, label: "Agree", type: "checkbox", required: true, appliesTo: "participant" }).returning();
    await expect(confirm()).rejects.toMatchObject({ code: "fields_incomplete" });
    await db.update(customFields).set({ isArchived: true }).where(eq(customFields.id, f.id));
    expect(await confirm()).toBe("confirmed");
  });
});
