import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/server/db/index.ts";
import { teams, tickets, type Event, type Participant } from "../../src/server/db/schema.ts";
import * as T from "../../src/server/teams/service.ts";
import { recomputeTeamStatus } from "../../src/server/teams/status.ts";
import { cleanupEvent, makeEvent, makeParticipant } from "../helpers.ts";

let event: Event;
const verified = () => makeParticipant(event, undefined, { verificationStatus: "verified" });

beforeEach(async () => {
  event = await makeEvent({ minTeamSize: 2, maxTeamSize: 3 });
});
afterEach(() => cleanupEvent(event.id));

async function confirmedTeam(): Promise<{ team: Awaited<ReturnType<typeof T.createTeam>>; lead: Participant; member: Participant }> {
  const lead = await verified();
  const member = await verified();
  const team = await T.createTeam(event, lead, "Squad");
  await T.joinByCode(event, member, team.inviteCode);
  expect(await recomputeTeamStatus(team.id)).toBe("confirmed");
  return { team, lead, member };
}

describe("team lifecycle", () => {
  it("creates a forming solo team with the creator as accepted lead", async () => {
    const lead = await verified();
    const team = await T.createTeam(event, lead, "Solo");
    expect(team.status).toBe("forming");
    const detail = await T.getTeamDetail(team, lead, false);
    expect(detail.members[0]).toMatchObject({ role: "lead", membershipStatus: "accepted" });
  });

  it("rejects a duplicate name case-insensitively", async () => {
    const a = await verified();
    const b = await verified();
    await T.createTeam(event, a, "Byte Me");
    await expect(T.createTeam(event, b, "byte me")).rejects.toMatchObject({ code: "name_taken" });
  });

  it("confirms at min size and enforces one-team + team-full", async () => {
    const { team, member } = await confirmedTeam();
    const third = await verified();
    await T.joinByCode(event, third, team.inviteCode); // 3 == max
    const fourth = await verified();
    await expect(T.joinByCode(event, fourth, team.inviteCode)).rejects.toMatchObject({ code: "team_full" });
    const other = await verified();
    const otherTeam = await T.createTeam(event, other, "Other");
    await expect(T.joinByCode(event, member, otherTeam.inviteCode)).rejects.toMatchObject({ code: "already_in_team" });
  });

  it("email invite resolves by canonical email and acceptance invalidates other pending invites", async () => {
    const lead = await verified();
    const teamA = await T.createTeam(event, lead, "A");
    await T.inviteByEmail(teamA, lead, "New+tag@Gmail.com");
    const lead2 = await verified();
    const teamB = await T.createTeam(event, lead2, "B");
    await T.inviteByEmail(teamB, lead2, "new@gmail.com");

    const invitee = await verified();
    // Both invites (from A and B) resolve to the same canonical email.
    const pending = await T.pendingInvitesForUser(event, "new@gmail.com");
    expect(pending).toHaveLength(2);
    const inviteA = pending.find((p) => p.teamId === teamA.id)!;
    await T.respondToInvite(event, invitee, "new@gmail.com", inviteA.id, true);
    expect((await T.acceptedMembership(invitee.id))?.teamId).toBe(teamA.id);
    // Accepting one revokes every other pending invite for this person.
    expect(await T.pendingInvitesForUser(event, "new@gmail.com")).toHaveLength(0);
  });

  it("removes a member (dropping below min → forming); removed member keeps their ticket implicitly", async () => {
    const { team, lead, member } = await confirmedTeam();
    await T.removeMember(event, team, lead, member.id);
    expect(await recomputeTeamStatus(team.id)).toBe("forming");
  });

  it("requires the lead to reassign before leaving; last member out withdraws the team", async () => {
    const { team, lead, member } = await confirmedTeam();
    await expect(T.leaveTeam(event, team, lead)).rejects.toMatchObject({ code: "reassign_first" });
    await T.reassignLead(event, team, lead, member.id);
    const reload = async () => (await db.select().from(teams).where(eq(teams.id, team.id)))[0];
    const t = await reload();
    expect(t.leadParticipantId).toBe(member.id);
    await T.leaveTeam(event, t, lead); // former lead (now a member) can leave
    await T.leaveTeam(event, await reload(), member); // last one out
    expect((await reload()).status).toBe("withdrawn");
  });

  it("regenerating the code invalidates the old one", async () => {
    const lead = await verified();
    const team = await T.createTeam(event, lead, "Codes");
    const oldCode = team.inviteCode;
    const newCode = await T.regenerateInviteCode(team, lead);
    expect(newCode).not.toBe(oldCode);
    const joiner = await verified();
    await expect(T.joinByCode(event, joiner, oldCode)).rejects.toMatchObject({ code: "bad_code" });
    await T.joinByCode(event, joiner, newCode);
    expect((await T.acceptedMembership(joiner.id))?.teamId).toBe(team.id);
  });

  it("blocks creation when the registration window is closed", async () => {
    const closed = await makeEvent({ registrationClosesAt: new Date(Date.now() - 1000) });
    const p = await makeParticipant(closed, undefined, { verificationStatus: "verified" });
    await expect(T.createTeam(closed, p, "Late")).rejects.toMatchObject({ code: "registration_closed" });
    await cleanupEvent(closed.id);
  });

  it("blocks a mentor-ticket holder from joining", async () => {
    const lead = await verified();
    const team = await T.createTeam(event, lead, "NoMentors");
    const mentor = await makeParticipant(event, undefined, { verificationStatus: "verified" });
    await db.insert(tickets).values({ eventId: event.id, humanitixTicketId: "mt", ticketTypeName: "Mentor", status: "complete", claimedByParticipantId: mentor.id });
    await expect(T.joinByCode(event, mentor, team.inviteCode)).rejects.toMatchObject({ code: "mentor_ineligible" });
  });
});
