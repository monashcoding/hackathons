import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  invites,
  participants,
  teamMembers,
  teams,
  tickets,
  type Event,
  type Participant,
  type Team,
} from "../db/schema.ts";
import { generateInviteCode } from "../lib/code.ts";
import { canonicaliseEmailForMatch } from "../lib/email.ts";
import { recordAudit } from "../lib/audit.ts";
import { isParticipantTicketType } from "../participants/verify.ts";
import { recomputeTeamStatus } from "./status.ts";

// Typed error so routes can map a domain failure to an HTTP status + message.
export class TeamError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400,
  ) {
    super(message);
  }
}

// Registration window is evaluated SERVER-SIDE against UTC — never trust client
// time. Null bounds mean "unbounded on that side" (permissive by default).
export function registrationOpen(event: Event, now = new Date()): boolean {
  const afterOpen = event.registrationOpensAt === null || now >= event.registrationOpensAt;
  const beforeClose = event.registrationClosesAt === null || now <= event.registrationClosesAt;
  return afterOpen && beforeClose;
}

function assertWindowOpen(event: Event): void {
  if (!registrationOpen(event)) {
    throw new TeamError("registration_closed", "Registration is closed for this event.", 403);
  }
}

// A participant is a mentor/volunteer (ineligible for team membership) if they
// hold a claimed ticket whose type is NOT a participant type. Unverified people
// (no ticket yet) are allowed to form teams — status just stays `forming`.
async function assertEligible(event: Event, participant: Participant): Promise<void> {
  const [t] = await db.select().from(tickets).where(eq(tickets.claimedByParticipantId, participant.id));
  if (t && !isParticipantTicketType(event, t.ticketTypeName)) {
    throw new TeamError(
      "mentor_ineligible",
      "Mentor/volunteer tickets can't join a team.",
      403,
    );
  }
}

// The one team a participant has actually accepted into (at most one).
export async function acceptedMembership(participantId: string) {
  const [row] = await db
    .select()
    .from(teamMembers)
    .where(
      and(eq(teamMembers.participantId, participantId), eq(teamMembers.membershipStatus, "accepted")),
    );
  return row ?? null;
}

async function assertNotAlreadyTeamed(participant: Participant): Promise<void> {
  if (await acceptedMembership(participant.id)) {
    throw new TeamError("already_in_team", "You're already in a team for this event.", 409);
  }
}

async function acceptedCount(teamId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.membershipStatus, "accepted")));
  return Number(row?.n ?? 0);
}

// When a participant accepts into a team, every other pending path for them is
// closed: other `invited` memberships → removed, and every still-pending email
// invite addressed to them → revoked (one team per person, spec §9).
async function closeOtherPaths(
  participantId: string,
  keepTeamId: string,
  userEmail: string | null,
): Promise<void> {
  await db
    .update(teamMembers)
    .set({ membershipStatus: "removed", respondedAt: new Date() })
    .where(
      and(
        eq(teamMembers.participantId, participantId),
        eq(teamMembers.membershipStatus, "invited"),
        ne(teamMembers.teamId, keepTeamId),
      ),
    );

  const canon = canonicaliseEmailForMatch(userEmail);
  if (canon) {
    await db
      .update(invites)
      .set({ status: "revoked" })
      .where(and(eq(invites.emailNormalised, canon), eq(invites.status, "pending")));
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createTeam(event: Event, lead: Participant, name: string): Promise<Team> {
  assertWindowOpen(event);
  await assertEligible(event, lead);
  await assertNotAlreadyTeamed(lead);

  const trimmed = name.trim();
  if (!trimmed) throw new TeamError("invalid_name", "Team name is required.");

  // Unique invite code with a few retries against the tiny collision chance.
  for (let attempt = 0; attempt < 5; attempt++) {
    const inviteCode = generateInviteCode();
    try {
      const team = await db.transaction(async (tx) => {
        const [t] = await tx
          .insert(teams)
          .values({ eventId: event.id, name: trimmed, leadParticipantId: lead.id, inviteCode })
          .returning();
        await tx.insert(teamMembers).values({
          teamId: t.id,
          participantId: lead.id,
          role: "lead",
          membershipStatus: "accepted",
          respondedAt: new Date(),
        });
        return t;
      });
      await recomputeTeamStatus(team.id);
      await recordAudit({
        eventId: event.id,
        actorMacUserId: lead.macUserId,
        action: "team.create",
        subjectType: "team",
        subjectId: team.id,
        detail: { name: trimmed },
      });
      return team;
    } catch (err) {
      if (isUnique(err, "teams_invite_code_unique")) continue; // retry new code
      if (isUnique(err, "teams_event_name_unique")) {
        throw new TeamError("name_taken", "That team name is already taken.", 409);
      }
      if (isUnique(err, "team_members_one_accepted_per_participant")) {
        throw new TeamError("already_in_team", "You're already in a team for this event.", 409);
      }
      throw err;
    }
  }
  throw new TeamError("code_collision", "Could not allocate an invite code, try again.", 500);
}

// ---------------------------------------------------------------------------
// Invite by email
// ---------------------------------------------------------------------------
export async function inviteByEmail(
  team: Team,
  by: Participant,
  email: string,
): Promise<void> {
  await assertLead(team, by);
  const canon = canonicaliseEmailForMatch(email);
  if (!canon) throw new TeamError("invalid_email", "Enter a valid email address.");
  await db.insert(invites).values({
    teamId: team.id,
    emailNormalised: canon,
    invitedByParticipantId: by.id,
  });
  await recordAudit({
    eventId: team.eventId,
    actorMacUserId: by.macUserId,
    action: "invite.create",
    subjectType: "team",
    subjectId: team.id,
    detail: { email: canon },
  });
}

// ---------------------------------------------------------------------------
// Join by code (entering the code IS the consent to join)
// ---------------------------------------------------------------------------
export async function joinByCode(
  event: Event,
  participant: Participant,
  code: string,
  userEmail: string | null = null,
): Promise<Team> {
  assertWindowOpen(event);
  await assertEligible(event, participant);

  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.eventId, event.id), eq(teams.inviteCode, code.trim().toUpperCase())));
  if (!team || team.status === "withdrawn") {
    throw new TeamError("bad_code", "That invite code isn't valid.", 404);
  }
  if (team.inviteCodeExpiresAt && new Date() > team.inviteCodeExpiresAt) {
    throw new TeamError("code_expired", "That invite code has expired.", 410);
  }
  if (team.inviteCodeMaxUses !== null && team.inviteCodeUses >= team.inviteCodeMaxUses) {
    throw new TeamError("code_used_up", "That invite code has been used up.", 410);
  }

  const existing = await acceptedMembership(participant.id);
  if (existing) {
    if (existing.teamId === team.id) return team; // idempotent
    throw new TeamError("already_in_team", "You're already in a team for this event.", 409);
  }
  if ((await acceptedCount(team.id)) >= event.maxTeamSize) {
    throw new TeamError("team_full", "That team is already full.", 409);
  }

  await db.transaction(async (tx) => {
    // Upsert this participant's membership to accepted (they may have a prior
    // invited/declined/removed row for this team).
    await tx
      .insert(teamMembers)
      .values({
        teamId: team.id,
        participantId: participant.id,
        role: "member",
        membershipStatus: "accepted",
        respondedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [teamMembers.teamId, teamMembers.participantId],
        set: { membershipStatus: "accepted", respondedAt: new Date() },
      });
    await tx
      .update(teams)
      .set({ inviteCodeUses: team.inviteCodeUses + 1, updatedAt: new Date() })
      .where(eq(teams.id, team.id));
  });
  await closeOtherPaths(participant.id, team.id, userEmail);
  await recomputeTeamStatus(team.id);
  await recordAudit({
    eventId: event.id,
    actorMacUserId: participant.macUserId,
    action: "team.join",
    subjectType: "team",
    subjectId: team.id,
    detail: { via: "code" },
  });
  return team;
}

// ---------------------------------------------------------------------------
// Email-invite resolution + accept/decline
// ---------------------------------------------------------------------------
export async function pendingInvitesForUser(event: Event, userEmail: string | null) {
  const canon = canonicaliseEmailForMatch(userEmail);
  if (!canon) return [];
  return db
    .select({ id: invites.id, teamId: invites.teamId, teamName: teams.name, status: invites.status })
    .from(invites)
    .innerJoin(teams, eq(invites.teamId, teams.id))
    .where(
      and(
        eq(teams.eventId, event.id),
        eq(invites.emailNormalised, canon),
        eq(invites.status, "pending"),
        ne(teams.status, "withdrawn"),
      ),
    );
}

export async function respondToInvite(
  event: Event,
  participant: Participant,
  userEmail: string | null,
  inviteId: string,
  accept: boolean,
): Promise<Team | null> {
  const [invite] = await db.select().from(invites).where(eq(invites.id, inviteId));
  if (!invite || invite.status !== "pending") {
    throw new TeamError("invite_gone", "That invite is no longer available.", 404);
  }
  // The invite is addressed to an email; only the person who owns that email
  // (their signed-in email) may act on it.
  if (canonicaliseEmailForMatch(userEmail) !== invite.emailNormalised) {
    throw new TeamError("invite_not_yours", "That invite isn't addressed to you.", 403);
  }

  if (!accept) {
    await db.update(invites).set({ status: "declined" }).where(eq(invites.id, inviteId));
    await recordAudit({
      eventId: event.id,
      actorMacUserId: participant.macUserId,
      action: "invite.declined",
      subjectType: "team",
      subjectId: invite.teamId,
    });
    return null;
  }

  assertWindowOpen(event);
  await assertEligible(event, participant);
  const [team] = await db.select().from(teams).where(eq(teams.id, invite.teamId));
  if (!team || team.status === "withdrawn") throw new TeamError("invite_gone", "That team is gone.", 404);
  await assertNotAlreadyTeamed(participant);
  if ((await acceptedCount(team.id)) >= event.maxTeamSize) {
    throw new TeamError("team_full", "That team is already full.", 409);
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(teamMembers)
      .values({
        teamId: team.id,
        participantId: participant.id,
        role: "member",
        membershipStatus: "accepted",
        respondedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [teamMembers.teamId, teamMembers.participantId],
        set: { membershipStatus: "accepted", respondedAt: new Date() },
      });
    await tx.update(invites).set({ status: "accepted" }).where(eq(invites.id, inviteId));
  });
  await closeOtherPaths(participant.id, team.id, userEmail);
  await recomputeTeamStatus(team.id);
  await recordAudit({
    eventId: event.id,
    actorMacUserId: participant.macUserId,
    action: "team.join",
    subjectType: "team",
    subjectId: team.id,
    detail: { via: "invite" },
  });
  return team;
}

// ---------------------------------------------------------------------------
// Membership management
// ---------------------------------------------------------------------------
async function assertLead(team: Team, actor: Participant): Promise<void> {
  if (team.leadParticipantId !== actor.id) {
    throw new TeamError("not_lead", "Only the team lead can do that.", 403);
  }
}

export async function removeMember(
  event: Event,
  team: Team,
  actor: Participant,
  targetParticipantId: string,
): Promise<void> {
  await assertLead(team, actor);
  if (targetParticipantId === actor.id) {
    throw new TeamError("cant_remove_self", "Use ‘leave team’ to remove yourself.", 400);
  }
  const [m] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.participantId, targetParticipantId)));
  if (!m || m.membershipStatus === "removed") {
    throw new TeamError("not_a_member", "That person isn't in the team.", 404);
  }
  // Mark removed (preserved). The member keeps their verified ticket — being
  // removed from a team must never strand a paying attendee.
  await db
    .update(teamMembers)
    .set({ membershipStatus: "removed", respondedAt: new Date() })
    .where(eq(teamMembers.id, m.id));
  await recomputeTeamStatus(team.id);
  await recordAudit({
    eventId: event.id,
    actorMacUserId: actor.macUserId,
    action: "team.member_removed",
    subjectType: "team",
    subjectId: team.id,
    detail: { participantId: targetParticipantId },
  });
}

export async function leaveTeam(event: Event, team: Team, participant: Participant): Promise<void> {
  const [m] = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, team.id),
        eq(teamMembers.participantId, participant.id),
        eq(teamMembers.membershipStatus, "accepted"),
      ),
    );
  if (!m) throw new TeamError("not_a_member", "You're not in this team.", 404);

  const others = (await acceptedCount(team.id)) - 1;
  if (team.leadParticipantId === participant.id && others > 0) {
    // Lead must hand over before leaving.
    throw new TeamError("reassign_first", "Reassign the team lead before you leave.", 409);
  }

  await db
    .update(teamMembers)
    .set({ membershipStatus: "removed", respondedAt: new Date() })
    .where(eq(teamMembers.id, m.id));

  if (others === 0) {
    // Last member out dissolves the team (soft — preserved).
    await db.update(teams).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(teams.id, team.id));
  } else {
    await recomputeTeamStatus(team.id);
  }
  await recordAudit({
    eventId: event.id,
    actorMacUserId: participant.macUserId,
    action: others === 0 ? "team.withdrawn" : "team.leave",
    subjectType: "team",
    subjectId: team.id,
  });
}

export async function reassignLead(
  event: Event,
  team: Team,
  actor: Participant,
  newLeadParticipantId: string,
): Promise<void> {
  await assertLead(team, actor);
  const [m] = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, team.id),
        eq(teamMembers.participantId, newLeadParticipantId),
        eq(teamMembers.membershipStatus, "accepted"),
      ),
    );
  if (!m) throw new TeamError("bad_new_lead", "The new lead must be an accepted team member.", 400);

  await db.transaction(async (tx) => {
    await tx.update(teams).set({ leadParticipantId: newLeadParticipantId, updatedAt: new Date() }).where(eq(teams.id, team.id));
    await tx
      .update(teamMembers)
      .set({ role: "member" })
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.participantId, actor.id)));
    await tx.update(teamMembers).set({ role: "lead" }).where(eq(teamMembers.id, m.id));
  });
  await recordAudit({
    eventId: event.id,
    actorMacUserId: actor.macUserId,
    action: "team.reassign_lead",
    subjectType: "team",
    subjectId: team.id,
    detail: { newLeadParticipantId },
  });
}

export async function regenerateInviteCode(team: Team, actor: Participant): Promise<string> {
  await assertLead(team, actor);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    try {
      await db
        .update(teams)
        .set({ inviteCode: code, inviteCodeUses: 0, updatedAt: new Date() })
        .where(eq(teams.id, team.id));
      await recordAudit({
        eventId: team.eventId,
        actorMacUserId: actor.macUserId,
        action: "team.regenerate_code",
        subjectType: "team",
        subjectId: team.id,
      });
      return code;
    } catch (err) {
      if (isUnique(err, "teams_invite_code_unique")) continue;
      throw err;
    }
  }
  throw new TeamError("code_collision", "Could not allocate a code, try again.", 500);
}

// ---------------------------------------------------------------------------
// Read: team detail with per-member state (the chips the dashboard renders)
// ---------------------------------------------------------------------------
export interface TeamMemberView {
  participantId: string;
  displayName: string | null;
  role: string;
  membershipStatus: string;
  verificationStatus: string;
  isYou: boolean;
}
export interface TeamDetail {
  id: string;
  name: string;
  status: string;
  isLead: boolean;
  inviteCode: string | null; // only exposed to the lead
  members: TeamMemberView[];
  pendingInvites: { id: string; email: string | null }[]; // emails only to lead/organiser
}

export async function getTeamDetail(
  team: Team,
  viewer: Participant | null,
  isOrganiser: boolean,
): Promise<TeamDetail> {
  const memberRows = await db
    .select({
      participantId: teamMembers.participantId,
      displayName: participants.displayName,
      role: teamMembers.role,
      membershipStatus: teamMembers.membershipStatus,
      verificationStatus: participants.verificationStatus,
    })
    .from(teamMembers)
    .innerJoin(participants, eq(teamMembers.participantId, participants.id))
    .where(and(eq(teamMembers.teamId, team.id), ne(teamMembers.membershipStatus, "removed")));

  const isLead = viewer !== null && team.leadParticipantId === viewer.id;
  const privileged = isLead || isOrganiser;

  const pending = await db
    .select({ id: invites.id, email: invites.emailNormalised })
    .from(invites)
    .where(and(eq(invites.teamId, team.id), eq(invites.status, "pending")));

  return {
    id: team.id,
    name: team.name,
    status: team.status,
    isLead,
    inviteCode: isLead ? team.inviteCode : null,
    members: memberRows.map((m) => ({
      participantId: m.participantId,
      displayName: m.displayName,
      role: m.role,
      membershipStatus: m.membershipStatus,
      verificationStatus: m.verificationStatus,
      isYou: viewer !== null && m.participantId === viewer.id,
    })),
    // Pending invite emails are PII: only the lead/organiser see them.
    pendingInvites: pending.map((p) => ({ id: p.id, email: privileged ? p.email : null })),
  };
}

function isUnique(err: unknown, constraint: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505" &&
    String((err as { constraint_name?: string }).constraint_name ?? "").includes(constraint)
  );
}
