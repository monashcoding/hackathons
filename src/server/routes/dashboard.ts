import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.ts";
import { participants, type Event, type Participant, type Ticket } from "../db/schema.ts";
import { getCurrentEvent } from "../lib/currentEvent.ts";
import { requireAuth, type AuthedRequest } from "../auth/middleware.ts";
import {
  attemptAutoMatch,
  claimByOrderReference,
  claimedTicket,
  ensureParticipant,
} from "../participants/verify.ts";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

// What a participant is allowed to see about themselves. No other person's PII.
function toParticipantView(p: Participant) {
  return {
    displayName: p.displayName,
    university: p.university,
    studyLevel: p.studyLevel,
    dietary: p.dietary,
    githubHandle: p.githubHandle,
    discordHandle: p.discordHandle,
    lookingForTeam: p.lookingForTeam,
    verificationStatus: p.verificationStatus,
    verifiedVia: p.verifiedVia,
  };
}

// The participant's own ticket — safe to show them their own type/order ref.
function toOwnTicketView(t: Ticket | null) {
  if (!t) return null;
  return {
    ticketTypeName: t.ticketTypeName,
    orderReference: t.orderReference,
    status: t.status,
    attendeeName: [t.attendeeFirstName, t.attendeeLastName].filter(Boolean).join(" ") || null,
  };
}

function toEventView(e: Event) {
  return {
    slug: e.slug,
    name: e.name,
    tagline: e.tagline,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    venue: e.venue,
    minTeamSize: e.minTeamSize,
    maxTeamSize: e.maxTeamSize,
  };
}

// GET /api/dashboard — the single most important page's data. Ensures the
// participant row exists, attempts email auto-match, and returns an unambiguous
// verification state. Creating-on-read is fine: it's idempotent.
dashboardRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  const user = req.user!;
  const event = await getCurrentEvent();
  if (!event) {
    res.json({ event: null });
    return;
  }

  let participant = await ensureParticipant(event, user);
  if (participant.verificationStatus === "unverified") {
    const matched = await attemptAutoMatch(event, participant, user.email);
    if (matched) participant = matched.participant;
  }
  const ticket = await claimedTicket(participant);

  res.json({
    event: toEventView(event),
    participant: toParticipantView(participant),
    ticket: toOwnTicketView(ticket),
    needsClaim: participant.verificationStatus === "unverified",
  });
});

const profileSchema = z.object({
  displayName: z.string().trim().max(120).nullish(),
  university: z.string().trim().max(160).nullish(),
  studyLevel: z.string().trim().max(80).nullish(),
  dietary: z.string().trim().max(200).nullish(),
  githubHandle: z.string().trim().max(80).nullish(),
  discordHandle: z.string().trim().max(80).nullish(),
  lookingForTeam: z.boolean().optional(),
});

// PATCH /api/participants/me — update own profile for the current event.
dashboardRouter.patch("/participants/me", async (req: AuthedRequest, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile", details: parsed.error.flatten() });
    return;
  }
  const event = await getCurrentEvent();
  if (!event) {
    res.status(400).json({ error: "No active event" });
    return;
  }
  const participant = await ensureParticipant(event, req.user!);
  const [updated] = await db
    .update(participants)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(participants.id, participant.id))
    .returning();
  res.json({ participant: toParticipantView(updated) });
});

const claimSchema = z.object({
  orderReference: z.string().trim().min(1).max(64),
  surname: z.string().trim().min(1).max(120),
});

// POST /api/claim — order-reference + surname claim flow (§8.2). Messages are
// deliberately generic: never reveal whether a reference exists or a surname is
// right, and always point a stuck user at the organisers.
dashboardRouter.post("/claim", async (req: AuthedRequest, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your order reference and surname." });
    return;
  }
  const event = await getCurrentEvent();
  if (!event) {
    res.status(400).json({ error: "No active event" });
    return;
  }
  const participant = await ensureParticipant(event, req.user!);
  const outcome = await claimByOrderReference(
    event,
    participant,
    parsed.data.orderReference,
    parsed.data.surname,
  );

  if (outcome.ok) {
    res.json({ ok: true, already: outcome.already ?? false });
    return;
  }
  switch (outcome.code) {
    case "locked":
      res.status(429).json({
        ok: false,
        error: "Too many attempts. Please contact the organisers to verify you manually.",
      });
      return;
    case "already_claimed":
      res.status(409).json({
        ok: false,
        error: "This ticket has already been claimed. Please contact the organisers.",
      });
      return;
    default:
      res.status(404).json({
        ok: false,
        error: "We couldn't match those details. Check your order reference and surname, or contact the organisers.",
      });
  }
});
