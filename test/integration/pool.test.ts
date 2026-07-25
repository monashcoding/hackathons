import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/server/db/index.ts";
import { participants, tickets, type Event } from "../../src/server/db/schema.ts";
import * as T from "../../src/server/teams/service.ts";
import { cleanupEvent, makeEvent, makeParticipant } from "../helpers.ts";

let event: Event;
beforeEach(async () => {
  event = await makeEvent({ minTeamSize: 2, maxTeamSize: 3 });
});
afterEach(() => cleanupEvent(event.id));

describe("looking-for-a-team pool (§9)", () => {
  it("lists only verified, opted-in, teamless, non-mentor participants and never exposes email", async () => {
    const viewer = await makeParticipant(event, undefined, { verificationStatus: "verified" });
    const strandedA = await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: true, displayName: "A" });
    const strandedB = await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: true, displayName: "B" });
    await makeParticipant(event, undefined, { verificationStatus: "unverified", lookingForTeam: true, displayName: "Unv" });
    await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: false, displayName: "NotLooking" });
    const mentor = await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: true, displayName: "Mentor" });
    await db.insert(tickets).values({ eventId: event.id, humanitixTicketId: "m", ticketTypeName: "Mentor", status: "complete", claimedByParticipantId: mentor.id });

    const pool = await T.findTeamPool(event, viewer.id);
    expect(pool.map((p) => p.displayName).sort()).toEqual(["A", "B"]);
    expect(Object.keys(pool[0])).not.toContain("email");
    void [strandedA, strandedB];
  });

  it("lead invites from the pool → invited → accept; leaving the pool", async () => {
    const lead = await makeParticipant(event, undefined, { verificationStatus: "verified" });
    const solo = await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: true, displayName: "Solo" });
    const team = await T.createTeam(event, lead, "Squad");

    await T.inviteParticipantToTeam(event, team, lead, solo.id);
    const invitations = await T.teamInvitationsForParticipant(solo.id);
    expect(invitations).toHaveLength(1);
    const detail = await T.getTeamDetail(team, lead, false);
    expect(detail.members.some((m) => m.participantId === solo.id && m.membershipStatus === "invited")).toBe(true);

    await T.respondToTeamInvitation(event, solo, team.id, true, "solo@x.io");
    expect((await T.acceptedMembership(solo.id))?.teamId).toBe(team.id);
    expect((await T.findTeamPool(event, lead.id)).some((p) => p.displayName === "Solo")).toBe(false);
  });

  it("declining keeps them in the pool", async () => {
    const lead = await makeParticipant(event, undefined, { verificationStatus: "verified" });
    const solo = await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: true, displayName: "Solo" });
    const team = await T.createTeam(event, lead, "Squad");
    await T.inviteParticipantToTeam(event, team, lead, solo.id);
    await T.respondToTeamInvitation(event, solo, team.id, false, "solo@x.io");
    expect((await T.findTeamPool(event, lead.id)).some((p) => p.displayName === "Solo")).toBe(true);
    expect(await T.teamInvitationsForParticipant(solo.id)).toHaveLength(0);
  });

  it("clears the looking-for-a-team flag once you're on a team (create + join)", async () => {
    const lead = await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: true });
    const joiner = await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: true });
    const team = await T.createTeam(event, lead, "Squad");
    await T.joinByCode(event, joiner, team.inviteCode);

    const looking = async (id: string) =>
      (await db.select().from(participants).where(eq(participants.id, id)))[0].lookingForTeam;
    // Both are now teamed, so the stale opt-in must be cleared — otherwise the
    // Team page shows a contradictory "I'm looking for a team" toggle.
    expect(await looking(lead.id)).toBe(false);
    expect(await looking(joiner.id)).toBe(false);

    const viewer = await makeParticipant(event, undefined, { verificationStatus: "verified" });
    expect(await T.findTeamPool(event, viewer.id)).toHaveLength(0);
  });

  it("guards: can't invite a mentor, an already-teamed person, or as a non-lead", async () => {
    const lead = await makeParticipant(event, undefined, { verificationStatus: "verified" });
    const member = await makeParticipant(event, undefined, { verificationStatus: "verified" });
    const team = await T.createTeam(event, lead, "Squad");
    await T.joinByCode(event, member, team.inviteCode);

    const mentor = await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: true });
    await db.insert(tickets).values({ eventId: event.id, humanitixTicketId: "m2", ticketTypeName: "Mentor", status: "complete", claimedByParticipantId: mentor.id });

    await expect(T.inviteParticipantToTeam(event, team, lead, mentor.id)).rejects.toMatchObject({ code: "mentor_ineligible" });
    await expect(T.inviteParticipantToTeam(event, team, lead, member.id)).rejects.toMatchObject({ code: "already_in_team" });
    const solo = await makeParticipant(event, undefined, { verificationStatus: "verified", lookingForTeam: true });
    await expect(T.inviteParticipantToTeam(event, team, member, solo.id)).rejects.toMatchObject({ code: "not_lead" });
  });
});
