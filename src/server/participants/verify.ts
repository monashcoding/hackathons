import { and, count, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  auditLog,
  participants,
  tickets,
  type Event,
  type Participant,
  type Ticket,
} from "../db/schema.ts";
import { canonicaliseEmailForMatch } from "../lib/email.ts";
import { recordAudit } from "../lib/audit.ts";
import type { MacUser } from "../auth/jwt.ts";

const MAX_CLAIM_ATTEMPTS_PER_HOUR = 5;

// A ticket type counts as a "participant" seat if it's in the event's configured
// participant list. If that list is empty (not configured yet), fall back to
// "anything that isn't explicitly a mentor type" so the flow still works before
// an organiser has mapped types. Comparison is trim + case-insensitive.
export function isParticipantTicketType(event: Event, ticketTypeName: string | null): boolean {
  const name = (ticketTypeName ?? "").trim().toLowerCase();
  if (!name) return false;
  const participantsTypes = (event.participantTicketTypes ?? []).map((s) => s.trim().toLowerCase());
  const mentorTypes = (event.mentorTicketTypes ?? []).map((s) => s.trim().toLowerCase());
  if (participantsTypes.length > 0) return participantsTypes.includes(name);
  return !mentorTypes.includes(name);
}

/** Ensure a participant row exists for this user+event. Idempotent. */
export async function ensureParticipant(event: Event, user: MacUser): Promise<Participant> {
  const [existing] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.eventId, event.id), eq(participants.macUserId, user.macUserId)));
  if (existing) return existing;

  const [row] = await db
    .insert(participants)
    .values({ eventId: event.id, macUserId: user.macUserId, displayName: user.name })
    .onConflictDoNothing()
    .returning();
  if (row) {
    await recordAudit({
      eventId: event.id,
      actorMacUserId: user.macUserId,
      action: "participant.register",
      subjectType: "participant",
      subjectId: row.id,
    });
    return row;
  }
  // Lost an insert race — re-read.
  const [again] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.eventId, event.id), eq(participants.macUserId, user.macUserId)));
  return again;
}

// The ticket a participant currently holds (if any).
export async function claimedTicket(participant: Participant): Promise<Ticket | null> {
  const [row] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.claimedByParticipantId, participant.id));
  return row ?? null;
}

type ClaimVia = "email_match" | "order_reference" | "exec_override";

// Atomically claim a specific ticket for a participant. Uses a conditional
// UPDATE (claimed_by IS NULL) so two racing claimants can't take the same seat —
// the loser gets null back. Also flips the participant to verified/override.
async function claimTicket(
  ticketId: string,
  participant: Participant,
  via: ClaimVia,
  status: "verified" | "override",
): Promise<{ ticket: Ticket; participant: Participant } | null> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .update(tickets)
      .set({ claimedByParticipantId: participant.id })
      .where(and(eq(tickets.id, ticketId), isNull(tickets.claimedByParticipantId)))
      .returning();
    if (!t) return null; // already claimed by someone else

    const [p] = await tx
      .update(participants)
      .set({
        verificationStatus: status,
        verifiedVia: via,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(participants.id, participant.id))
      .returning();
    return { ticket: t, participant: p };
  });
}

// ---------------------------------------------------------------------------
// 8.1 Auto-match (the happy path)
// ---------------------------------------------------------------------------
export async function attemptAutoMatch(
  event: Event,
  participant: Participant,
  userEmail: string | null,
): Promise<{ ticket: Ticket; participant: Participant } | null> {
  if (participant.verificationStatus === "verified" || participant.verificationStatus === "override") {
    return null;
  }
  const canon = canonicaliseEmailForMatch(userEmail);
  if (!canon) return null;

  const candidates = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.eventId, event.id),
        eq(tickets.status, "complete"),
        isNull(tickets.claimedByParticipantId),
      ),
    );

  const match = candidates.find(
    (t) =>
      isParticipantTicketType(event, t.ticketTypeName) &&
      canonicaliseEmailForMatch(t.attendeeEmailNormalised) === canon,
  );
  if (!match) return null;

  const res = await claimTicket(match.id, participant, "email_match", "verified");
  if (res) {
    await recordAudit({
      eventId: event.id,
      actorMacUserId: participant.macUserId,
      action: "participant.verified",
      subjectType: "participant",
      subjectId: participant.id,
      detail: { via: "email_match", ticketId: res.ticket.id },
    });
  }
  return res;
}

// ---------------------------------------------------------------------------
// 8.2 Claim by order reference + surname
// ---------------------------------------------------------------------------
export type ClaimOutcome =
  | { ok: true; already?: boolean }
  | { ok: false; code: "locked" | "invalid" | "no_match" | "already_claimed" };

async function recentFailedClaims(macUserId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actorMacUserId, macUserId),
        eq(auditLog.action, "claim.failed"),
        gt(auditLog.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function claimByOrderReference(
  event: Event,
  participant: Participant,
  orderReferenceInput: string,
  surnameInput: string,
): Promise<ClaimOutcome> {
  if (participant.verificationStatus === "verified" || participant.verificationStatus === "override") {
    return { ok: true, already: true };
  }

  // Rate limit: 5 failed attempts/hour, then lock and route to organiser override.
  if ((await recentFailedClaims(participant.macUserId)) >= MAX_CLAIM_ATTEMPTS_PER_HOUR) {
    return { ok: false, code: "locked" };
  }

  const ref = orderReferenceInput.trim();
  const surname = surnameInput.trim().toLowerCase();
  const fail = async (reason: string): Promise<void> => {
    await recordAudit({
      eventId: event.id,
      actorMacUserId: participant.macUserId,
      action: "claim.failed",
      subjectType: "participant",
      subjectId: participant.id,
      detail: { reason, orderReference: ref },
    });
  };

  if (!ref || !surname) {
    await fail("missing_fields");
    return { ok: false, code: "invalid" };
  }

  // All tickets under this order reference (short human code), participant-type,
  // still valid.
  const orderTickets = (
    await db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.eventId, event.id),
          sql`lower(${tickets.orderReference}) = ${ref.toLowerCase()}`,
          eq(tickets.status, "complete"),
        ),
      )
  ).filter((t) => isParticipantTicketType(event, t.ticketTypeName));

  // Surname is the second factor: it must match a ticket in that order. We never
  // reveal whether the reference itself existed — both "no such order" and
  // "wrong surname" return the same generic no_match.
  const surnameMatches = orderTickets.filter(
    (t) => (t.attendeeLastName ?? "").trim().toLowerCase() === surname,
  );
  if (surnameMatches.length === 0) {
    await fail(orderTickets.length === 0 ? "no_order" : "surname_mismatch");
    return { ok: false, code: "no_match" };
  }

  const unclaimed = surnameMatches.filter((t) => !t.claimedByParticipantId);
  if (unclaimed.length === 0) {
    // Every matching ticket is taken. If it's this same participant, that's fine.
    if (surnameMatches.some((t) => t.claimedByParticipantId === participant.id)) {
      return { ok: true, already: true };
    }
    // Do NOT leak surname correctness — this is the "already claimed" message.
    return { ok: false, code: "already_claimed" };
  }

  const res = await claimTicket(unclaimed[0].id, participant, "order_reference", "verified");
  if (!res) return { ok: false, code: "already_claimed" }; // lost the race
  await recordAudit({
    eventId: event.id,
    actorMacUserId: participant.macUserId,
    action: "participant.verified",
    subjectType: "participant",
    subjectId: participant.id,
    detail: { via: "order_reference", ticketId: res.ticket.id, orderReference: ref },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 8.4 Revocation — called from the ticket sweep. A claimed ticket that is no
// longer `complete` (refunded, cancelled, or vanished/transferred) revokes its
// holder and RELEASES the ticket so a transferee can claim it. The participant
// is marked `revoked`, not deleted. (Flagging their team is stage 5.)
// ---------------------------------------------------------------------------
export async function revokeInvalidClaims(event: Event): Promise<number> {
  const invalid = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.eventId, event.id),
        ne(tickets.status, "complete"),
        isNotNull(tickets.claimedByParticipantId),
      ),
    );

  for (const t of invalid) {
    const participantId = t.claimedByParticipantId!;
    await db.transaction(async (tx) => {
      // Release the ticket.
      await tx.update(tickets).set({ claimedByParticipantId: null }).where(eq(tickets.id, t.id));
      // Revoke the holder (preserve the row).
      await tx
        .update(participants)
        .set({ verificationStatus: "revoked", updatedAt: new Date() })
        .where(eq(participants.id, participantId));
    });
    await recordAudit({
      eventId: event.id,
      action: "participant.revoked",
      subjectType: "participant",
      subjectId: participantId,
      detail: { reason: t.status, ticketId: t.id, humanitixTicketId: t.humanitixTicketId },
      // system action — no human actor
    });
  }
  return invalid.length;
}

// ---------------------------------------------------------------------------
// 8.3 Organiser override — the release valve that makes strict verification safe
// ---------------------------------------------------------------------------
export async function organiserOverride(
  event: Event,
  participant: Participant,
  actorMacUserId: string,
  note: string,
  ticketId?: string,
): Promise<Participant> {
  // Optionally attach a specific ticket; otherwise just mark the human verified.
  if (ticketId) {
    await claimTicket(ticketId, participant, "exec_override", "override");
  }
  const [p] = await db
    .update(participants)
    .set({
      verificationStatus: "override",
      verifiedVia: "exec_override",
      verifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(participants.id, participant.id))
    .returning();

  await recordAudit({
    eventId: event.id,
    actorMacUserId,
    action: "participant.override",
    subjectType: "participant",
    subjectId: participant.id,
    detail: { note, ticketId: ticketId ?? null }, // note is mandatory (caller-enforced)
  });
  return p;
}
