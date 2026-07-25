import { and, eq, ne, notInArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import { invites, participants, teamMembers, teams, tickets } from "../db/schema.ts";

// ---------------------------------------------------------------------------
// Organiser reporting: the team board, the gap report, and the confirmed-teams
// CSV export. These are the views the director currently rebuilds by hand — the
// whole reason this project exists.
// ---------------------------------------------------------------------------

// The email we actually hold for a participant is the one on their claimed,
// paid ticket (the order email). Sign-in email is never stored. Null if a person
// is verified purely by organiser override with no attached ticket.
async function ticketEmailByParticipant(eventId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ pid: tickets.claimedByParticipantId, email: tickets.attendeeEmailNormalised })
    .from(tickets)
    .where(eq(tickets.eventId, eventId));
  const map = new Map<string, string>();
  for (const r of rows) if (r.pid && r.email) map.set(r.pid, r.email);
  return map;
}

// ---------------------------------------------------------------------------
// Team board — every (non-withdrawn) team with status + member breakdown.
// ---------------------------------------------------------------------------
export interface TeamBoardRow {
  id: string;
  name: string;
  status: string;
  leadParticipantId: string;
  members: {
    participantId: string;
    displayName: string | null;
    role: string;
    membershipStatus: string;
    verificationStatus: string;
    university: string | null;
    studyLevel: string | null;
    githubHandle: string | null;
    discordHandle: string | null;
  }[];
  pendingInviteCount: number;
}

export async function teamBoard(eventId: string): Promise<TeamBoardRow[]> {
  const teamRows = await db
    .select()
    .from(teams)
    .where(and(eq(teams.eventId, eventId), ne(teams.status, "withdrawn")));

  const memberRows = await db
    .select({
      teamId: teamMembers.teamId,
      participantId: teamMembers.participantId,
      displayName: participants.displayName,
      role: teamMembers.role,
      membershipStatus: teamMembers.membershipStatus,
      verificationStatus: participants.verificationStatus,
      university: participants.university,
      studyLevel: participants.studyLevel,
      githubHandle: participants.githubHandle,
      discordHandle: participants.discordHandle,
    })
    .from(teamMembers)
    .innerJoin(participants, eq(teamMembers.participantId, participants.id))
    .where(ne(teamMembers.membershipStatus, "removed"));

  const pendingRows = await db
    .select({ teamId: invites.teamId })
    .from(invites)
    .where(eq(invites.status, "pending"));

  const membersByTeam = new Map<string, TeamBoardRow["members"]>();
  for (const m of memberRows) {
    const list = membersByTeam.get(m.teamId) ?? [];
    list.push({
      participantId: m.participantId,
      displayName: m.displayName,
      role: m.role,
      membershipStatus: m.membershipStatus,
      verificationStatus: m.verificationStatus,
      university: m.university,
      studyLevel: m.studyLevel,
      githubHandle: m.githubHandle,
      discordHandle: m.discordHandle,
    });
    membersByTeam.set(m.teamId, list);
  }
  const pendingByTeam = new Map<string, number>();
  for (const p of pendingRows) pendingByTeam.set(p.teamId, (pendingByTeam.get(p.teamId) ?? 0) + 1);

  return teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    leadParticipantId: t.leadParticipantId,
    members: membersByTeam.get(t.id) ?? [],
    pendingInviteCount: pendingByTeam.get(t.id) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Gap report — the director's most-used view.
// ---------------------------------------------------------------------------
export interface GapReport {
  ticketHoldersWithoutTeam: { participantId: string; displayName: string | null; university: string | null; email: string | null }[];
  teamMembersWithoutTicket: { participantId: string; displayName: string | null; teamName: string; verificationStatus: string }[];
  unacceptedInvites: { teamName: string; who: string | null; kind: "email" | "member" }[];
}

export async function gapReport(eventId: string): Promise<GapReport> {
  const emailByPid = await ticketEmailByParticipant(eventId);

  // Participants accepted into a non-withdrawn team (used to exclude).
  const teamedRows = await db
    .select({ participantId: teamMembers.participantId })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(
      and(
        eq(teams.eventId, eventId),
        eq(teamMembers.membershipStatus, "accepted"),
        ne(teams.status, "withdrawn"),
      ),
    );
  const teamedIds = teamedRows.map((r) => r.participantId);

  // 1) Verified ticket-holders with no team — the load-bearing "stranded" list.
  const soloVerified = await db
    .select({ id: participants.id, displayName: participants.displayName, university: participants.university })
    .from(participants)
    .where(
      and(
        eq(participants.eventId, eventId),
        // verification in (verified, override)
        notInArray(participants.verificationStatus, ["unverified", "revoked"]),
        teamedIds.length > 0 ? notInArray(participants.id, teamedIds) : undefined,
      ),
    );

  // 2) Accepted team members who are NOT verified (unverified or revoked ticket).
  const membersNoTicket = await db
    .select({
      participantId: participants.id,
      displayName: participants.displayName,
      teamName: teams.name,
      verificationStatus: participants.verificationStatus,
    })
    .from(teamMembers)
    .innerJoin(participants, eq(teamMembers.participantId, participants.id))
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(
      and(
        eq(teams.eventId, eventId),
        eq(teamMembers.membershipStatus, "accepted"),
        ne(teams.status, "withdrawn"),
        // NOT verified/override => unverified or revoked (a member with no ticket).
        notInArray(participants.verificationStatus, ["verified", "override"]),
      ),
    );

  // 3) Unaccepted invites: pending email invites + `invited` memberships.
  const pendingEmail = await db
    .select({ teamName: teams.name, email: invites.emailNormalised })
    .from(invites)
    .innerJoin(teams, eq(invites.teamId, teams.id))
    .where(and(eq(teams.eventId, eventId), eq(invites.status, "pending"), ne(teams.status, "withdrawn")));

  const invitedMembers = await db
    .select({ teamName: teams.name, displayName: participants.displayName })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .innerJoin(participants, eq(teamMembers.participantId, participants.id))
    .where(and(eq(teams.eventId, eventId), eq(teamMembers.membershipStatus, "invited"), ne(teams.status, "withdrawn")));

  return {
    ticketHoldersWithoutTeam: soloVerified.map((p) => ({
      participantId: p.id,
      displayName: p.displayName,
      university: p.university,
      email: emailByPid.get(p.id) ?? null,
    })),
    teamMembersWithoutTicket: membersNoTicket.map((m) => ({
      participantId: m.participantId,
      displayName: m.displayName,
      teamName: m.teamName,
      verificationStatus: m.verificationStatus,
    })),
    unacceptedInvites: [
      ...pendingEmail.map((p) => ({ teamName: p.teamName, who: p.email, kind: "email" as const })),
      ...invitedMembers.map((m) => ({ teamName: m.teamName, who: m.displayName, kind: "member" as const })),
    ],
  };
}

// ---------------------------------------------------------------------------
// CSV export of CONFIRMED teams for the Devpost handoff.
// ---------------------------------------------------------------------------
function csvCell(value: string | null | undefined): string {
  const s = value ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function confirmedTeamsCsv(eventId: string): Promise<string> {
  const emailByPid = await ticketEmailByParticipant(eventId);

  const rows = await db
    .select({
      teamName: teams.name,
      teamStatus: teams.status,
      participantId: participants.id,
      displayName: participants.displayName,
      university: participants.university,
      role: teamMembers.role,
    })
    .from(teams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .innerJoin(participants, eq(teamMembers.participantId, participants.id))
    .where(
      and(
        eq(teams.eventId, eventId),
        eq(teams.status, "confirmed"),
        eq(teamMembers.membershipStatus, "accepted"),
      ),
    );

  const header = ["team_name", "member_name", "member_email", "university", "role"];
  const lines = [header.join(",")];
  // Stable order: by team, lead first.
  rows.sort((a, b) => a.teamName.localeCompare(b.teamName) || (a.role === "lead" ? -1 : 1));
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.teamName),
        csvCell(r.displayName),
        csvCell(emailByPid.get(r.participantId) ?? null),
        csvCell(r.university),
        csvCell(r.role),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
