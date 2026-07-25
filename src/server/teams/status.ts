import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db/index.ts";
import { participants, teamMembers, teams, type Team } from "../db/schema.ts";

// ---------------------------------------------------------------------------
// Team status. The lead OWNS the forming ⇄ confirmed choice (see
// setTeamStatus in service.ts) — everyone on a team is already ticket-verified,
// so "confirmed" just means the lead has declared the team locked. The system
// only ever imposes two states, and they are safety signals, not preferences:
//
//  flagged   — an accepted member's ticket is `revoked` (bought, then went away).
//              This ALWAYS overrides the lead's choice so the organiser sees the
//              breakage. Recomputed on every mutation and after every sweep.
//  withdrawn — soft-deleted; terminal, left alone here.
//
// forming/confirmed are never "wished into existence" by the system — they are
// preserved as the lead set them, unless a revocation flips the team to flagged.
// ---------------------------------------------------------------------------
export function deriveStatus(
  current: Team["status"],
  members: { membershipStatus: string; verificationStatus: string }[],
): Team["status"] {
  if (current === "withdrawn") return "withdrawn";

  const accepted = members.filter((m) => m.membershipStatus === "accepted");
  const anyRevoked = accepted.some((m) => m.verificationStatus === "revoked");

  // Safety override wins over whatever the lead chose.
  if (anyRevoked) return "flagged";
  // The breakage cleared (ticket restored, or the member left): drop back to
  // forming so the lead consciously re-confirms rather than silently re-locking.
  if (current === "flagged") return "forming";
  // Otherwise honour the lead's forming/confirmed choice.
  return current;
}

// Recompute and persist one team's SAFETY status (flagged / un-flagged). Never
// promotes to confirmed — that's the lead's call. Returns the new status.
export async function recomputeTeamStatus(teamId: string): Promise<Team["status"] | null> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.status === "withdrawn") return team?.status ?? null;

  const rows = await db
    .select({
      membershipStatus: teamMembers.membershipStatus,
      verificationStatus: participants.verificationStatus,
    })
    .from(teamMembers)
    .innerJoin(participants, eq(teamMembers.participantId, participants.id))
    .where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.membershipStatus, "removed")));

  const next = deriveStatus(team.status, rows);
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
