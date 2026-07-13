import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db/index.ts";
import { events, participants, teamMembers, teams, type Event, type Team } from "../db/schema.ts";
import { requiredCustomFieldsSatisfied } from "../customfields/service.ts";

// ---------------------------------------------------------------------------
// Derived team status (spec §9). Recomputed on EVERY relevant mutation and after
// every ticket sweep — never set by hand, never "wished into existence".
//
//  confirmed — every accepted member is verified/override, size within [min,max],
//              and nobody is still merely `invited`. (Required custom fields are
//              a stage-7 gate and fold in here later.)
//  flagged   — an accepted member is `revoked` (a ticket that went away). The
//              loud "was fine, now broken" signal for the team lead.
//  forming   — anything else that isn't withdrawn: too small, unaccepted invites,
//              or an unverified member.
//  withdrawn — soft-deleted; left alone here.
// ---------------------------------------------------------------------------
export function deriveStatus(
  event: Pick<Event, "minTeamSize" | "maxTeamSize">,
  current: Team["status"],
  members: { membershipStatus: string; verificationStatus: string }[],
  requiredFieldsAnswered: boolean,
): Team["status"] {
  if (current === "withdrawn") return "withdrawn";

  const accepted = members.filter((m) => m.membershipStatus === "accepted");
  const hasInvited = members.some((m) => m.membershipStatus === "invited");
  const anyRevoked = accepted.some((m) => m.verificationStatus === "revoked");
  const allVerified = accepted.every(
    (m) => m.verificationStatus === "verified" || m.verificationStatus === "override",
  );
  const sizeOk = accepted.length >= event.minTeamSize && accepted.length <= event.maxTeamSize;

  if (sizeOk && !hasInvited && allVerified && requiredFieldsAnswered) return "confirmed";
  if (anyRevoked) return "flagged";
  return "forming";
}

// Recompute and persist one team's status. Returns the new status.
export async function recomputeTeamStatus(teamId: string): Promise<Team["status"] | null> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.status === "withdrawn") return team?.status ?? null;

  const [event] = await db.select().from(events).where(eq(events.id, team.eventId));
  if (!event) return team.status;

  const rows = await db
    .select({
      participantId: teamMembers.participantId,
      membershipStatus: teamMembers.membershipStatus,
      verificationStatus: participants.verificationStatus,
    })
    .from(teamMembers)
    .innerJoin(participants, eq(teamMembers.participantId, participants.id))
    .where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.membershipStatus, "removed")));

  const acceptedIds = rows.filter((r) => r.membershipStatus === "accepted").map((r) => r.participantId);
  const fieldsOk = await requiredCustomFieldsSatisfied(event, teamId, acceptedIds);

  const next = deriveStatus(event, team.status, rows, fieldsOk);
  if (next !== team.status) {
    await db.update(teams).set({ status: next, updatedAt: new Date() }).where(eq(teams.id, teamId));
  }
  return next;
}

// Recompute every non-withdrawn team for an event (used after a ticket sweep).
export async function recomputeAllTeamsForEvent(eventId: string): Promise<void> {
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.eventId, eventId), ne(teams.status, "withdrawn")));
  for (const r of rows) await recomputeTeamStatus(r.id);
}

// Recompute the teams a set of participants belong to (used after revocation).
export async function recomputeTeamsForParticipants(participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return;
  const rows = await db
    .selectDistinct({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(inArray(teamMembers.participantId, participantIds));
  for (const r of rows) await recomputeTeamStatus(r.teamId);
}
