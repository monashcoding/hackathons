import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/server/db/index.ts";
import { customFields, type Event, type Participant } from "../../src/server/db/schema.ts";
import * as T from "../../src/server/teams/service.ts";
import { recomputeTeamStatus } from "../../src/server/teams/status.ts";
import * as CF from "../../src/server/customfields/service.ts";
import { cleanupEvent, makeEvent, makeParticipant } from "../helpers.ts";

let event: Event;
let lead: Participant;
let member: Participant;
let teamId: string;

beforeEach(async () => {
  event = await makeEvent({ minTeamSize: 2, maxTeamSize: 3 });
  lead = await makeParticipant(event, undefined, { verificationStatus: "verified" });
  member = await makeParticipant(event, undefined, { verificationStatus: "verified" });
  const team = await T.createTeam(event, lead, "Squad");
  await T.joinByCode(event, member, team.inviteCode);
  teamId = team.id;
  expect(await recomputeTeamStatus(teamId)).toBe("confirmed");
});
afterEach(() => cleanupEvent(event.id));

describe("required custom fields gate confirmation (§7/§9)", () => {
  it("a required participant field blocks confirmation until every member answers", async () => {
    const [f] = await db.insert(customFields).values({ eventId: event.id, label: "Dietary", type: "text", required: true, appliesTo: "participant" }).returning();
    expect(await recomputeTeamStatus(teamId)).toBe("forming");
    await CF.upsertParticipantResponses(event, lead.id, { [f.id]: "Vegan" });
    expect(await recomputeTeamStatus(teamId)).toBe("forming");
    await CF.upsertParticipantResponses(event, member.id, { [f.id]: "None" });
    expect(await recomputeTeamStatus(teamId)).toBe("confirmed");
  });

  it("a required team field is answered by the lead, and invalid options are rejected", async () => {
    const [f] = await db.insert(customFields).values({ eventId: event.id, label: "Track", type: "select", options: ["AI", "Web"], required: true, appliesTo: "team" }).returning();
    expect(await recomputeTeamStatus(teamId)).toBe("forming");
    await expect(CF.upsertTeamResponses(event, teamId, { [f.id]: "Games" })).rejects.toThrow();
    await CF.upsertTeamResponses(event, teamId, { [f.id]: "AI" });
    expect(await recomputeTeamStatus(teamId)).toBe("confirmed");
  });

  it("archiving a required field unblocks", async () => {
    const [f] = await db.insert(customFields).values({ eventId: event.id, label: "Agree", type: "checkbox", required: true, appliesTo: "participant" }).returning();
    expect(await recomputeTeamStatus(teamId)).toBe("forming");
    await db.update(customFields).set({ isArchived: true }).where(eq(customFields.id, f.id));
    expect(await recomputeTeamStatus(teamId)).toBe("confirmed");
  });
});
