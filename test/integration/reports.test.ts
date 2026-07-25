import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/server/db/index.ts";
import { participants as participantsTbl, tickets, type Event, type Participant } from "../../src/server/db/schema.ts";
import * as T from "../../src/server/teams/service.ts";
import { recomputeTeamStatus } from "../../src/server/teams/status.ts";
import { confirmedTeamsCsv, gapReport, teamBoard } from "../../src/server/organiser/reports.ts";
import { cleanupEvent, makeEvent, makeParticipant, makeTicket } from "../helpers.ts";

let event: Event;

// A verified participant with a claimed ticket carrying an email (the only email
// the reports/CSV can surface).
async function verifiedWithTicket(name: string, university: string): Promise<Participant> {
  const p = await makeParticipant(event, undefined, { verificationStatus: "verified", displayName: name, university });
  await makeTicket(event, { claimedByParticipantId: p.id, attendeeEmailNormalised: `${name.toLowerCase()}@x.io` });
  return p;
}

// Simulate a ticket being refunded/cancelled AFTER the member joined: the ticket
// is released and the participant is revoked. Since joining a team now requires
// verification, this (not "joined while unverified") is how a team ends up with a
// member who has no valid ticket.
async function revokeTicket(p: Participant): Promise<void> {
  await db.update(tickets).set({ claimedByParticipantId: null }).where(eq(tickets.claimedByParticipantId, p.id));
  await db.update(participantsTbl).set({ verificationStatus: "revoked" }).where(eq(participantsTbl.id, p.id));
}

beforeEach(async () => {
  event = await makeEvent({ minTeamSize: 2, maxTeamSize: 3 });
});
afterEach(() => cleanupEvent(event.id));

describe("organiser reports", () => {
  it("team board reflects statuses and pending invites", async () => {
    const a1 = await verifiedWithTicket("Ada", "Monash");
    const a2 = await verifiedWithTicket("Bo", "RMIT");
    const alpha = await T.createTeam(event, a1, "Alpha");
    await T.joinByCode(event, a2, alpha.inviteCode);
    await recomputeTeamStatus(alpha.id);

    const b1 = await verifiedWithTicket("Cy", "Deakin");
    const bravo = await T.createTeam(event, b1, "Bravo");
    const b2 = await verifiedWithTicket("Di", "UTS");
    await T.joinByCode(event, b2, bravo.inviteCode);
    await revokeTicket(b2); // ticket refunded after joining -> team flagged
    await recomputeTeamStatus(bravo.id);
    await T.inviteByEmail(bravo, b1, "ghost@example.com");

    const board = await teamBoard(event.id);
    const bAlpha = board.find((t) => t.name === "Alpha")!;
    const bBravo = board.find((t) => t.name === "Bravo")!;
    expect(bAlpha.status).toBe("confirmed");
    expect(bAlpha.members.filter((m) => m.membershipStatus === "accepted")).toHaveLength(2);
    expect(bBravo.status).toBe("flagged");
    expect(bBravo.pendingInviteCount).toBe(1);
  });

  it("gap report lists stranded verified, members without a ticket, and unaccepted invites", async () => {
    const a1 = await verifiedWithTicket("Ada", "Monash");
    const a2 = await verifiedWithTicket("Bo", "RMIT");
    const alpha = await T.createTeam(event, a1, "Alpha");
    await T.joinByCode(event, a2, alpha.inviteCode);
    await recomputeTeamStatus(alpha.id);

    const b1 = await verifiedWithTicket("Cy", "Deakin");
    const bravo = await T.createTeam(event, b1, "Bravo");
    const b2 = await verifiedWithTicket("Di", "UTS");
    await T.joinByCode(event, b2, bravo.inviteCode);
    await revokeTicket(b2); // ticket refunded after joining -> member without a ticket
    await T.inviteByEmail(bravo, b1, "ghost@example.com");

    await verifiedWithTicket("Ed", "ANU"); // stranded, verified, no team

    const report = await gapReport(event.id);
    expect(report.ticketHoldersWithoutTeam.some((p) => p.displayName === "Ed")).toBe(true);
    expect(report.ticketHoldersWithoutTeam.some((p) => ["Ada", "Bo", "Cy"].includes(p.displayName ?? ""))).toBe(false);
    expect(report.ticketHoldersWithoutTeam.find((p) => p.displayName === "Ed")?.email).toBeTruthy();
    expect(report.teamMembersWithoutTicket.some((m) => m.displayName === "Di" && m.teamName === "Bravo")).toBe(true);
    expect(report.unacceptedInvites.some((i) => i.kind === "email" && i.teamName === "Bravo")).toBe(true);
  });

  it("CSV exports confirmed teams only, with emails and universities", async () => {
    const a1 = await verifiedWithTicket("Ada", "Monash");
    const a2 = await verifiedWithTicket("Bo", "RMIT");
    const alpha = await T.createTeam(event, a1, "Alpha");
    await T.joinByCode(event, a2, alpha.inviteCode);
    await recomputeTeamStatus(alpha.id);

    const b1 = await verifiedWithTicket("Cy", "Deakin");
    const bravo = await T.createTeam(event, b1, "Bravo"); // forming (solo)
    void bravo;

    const csv = await confirmedTeamsCsv(event.id);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("team_name,member_name,member_email,university,role");
    expect(csv).toContain("Alpha");
    expect(csv).toContain("Ada");
    expect(csv).not.toContain("Bravo");
    const adaLine = lines.find((l) => l.includes("Ada"))!;
    expect(adaLine.split(",")[2]).toContain("@");
    expect(csv).toContain("Monash");
  });
});
