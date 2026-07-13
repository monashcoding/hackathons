import { Router } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.ts";
import { auditLog, events, participants } from "../db/schema.ts";
import { getCurrentEvent } from "../lib/currentEvent.ts";
import { organiserOverride } from "../participants/verify.ts";
import { requireAuth, requireOrganiser, type AuthedRequest } from "../auth/middleware.ts";

export const organiserRouter = Router();
organiserRouter.use(requireAuth, requireOrganiser);

async function resolveEvent(eventId?: string) {
  if (eventId) {
    const [e] = await db.select().from(events).where(eq(events.id, eventId));
    return e ?? null;
  }
  return getCurrentEvent();
}

// GET /api/organiser/overrides?eventId= — the override queue. Everyone not yet
// verified: unverified (needs claiming / stuck) and revoked (ticket went away).
// Includes each person's failed claim attempts so the organiser has context —
// exactly what the participant typed — without leaking it to anyone else.
organiserRouter.get("/overrides", async (req: AuthedRequest, res) => {
  const event = await resolveEvent(req.query.eventId as string | undefined);
  if (!event) {
    res.json({ event: null, participants: [] });
    return;
  }

  const rows = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.eventId, event.id),
        inArray(participants.verificationStatus, ["unverified", "revoked"]),
      ),
    )
    .orderBy(desc(participants.createdAt));

  // Pull recent failed claim attempts for these people, grouped by user.
  const userIds = rows.map((r) => r.macUserId);
  const attemptsByUser = new Map<string, { orderReference: unknown; at: Date }[]>();
  if (userIds.length > 0) {
    const attempts = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventId, event.id),
          eq(auditLog.action, "claim.failed"),
          inArray(auditLog.actorMacUserId, userIds),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(500);
    for (const a of attempts) {
      if (!a.actorMacUserId) continue;
      const list = attemptsByUser.get(a.actorMacUserId) ?? [];
      list.push({ orderReference: (a.detail as { orderReference?: unknown })?.orderReference, at: a.createdAt });
      attemptsByUser.set(a.actorMacUserId, list);
    }
  }

  res.json({
    event: { id: event.id, slug: event.slug, name: event.name },
    participants: rows.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      verificationStatus: p.verificationStatus,
      createdAt: p.createdAt,
      failedAttempts: attemptsByUser.get(p.macUserId) ?? [],
    })),
  });
});

const verifySchema = z.object({
  // Note is MANDATORY — the override is only safe because it's auditable.
  note: z.string().trim().min(1).max(1000),
  ticketId: z.string().uuid().optional(),
});

// POST /api/organiser/participants/:id/verify — manual verification (§8.3).
organiserRouter.post(
  "/participants/:id/verify",
  async (req: AuthedRequest, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A note is required to override.", details: parsed.error.flatten() });
      return;
    }
    const [participant] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, req.params.id));
    if (!participant) {
      res.status(404).json({ error: "Participant not found" });
      return;
    }
    const [event] = await db.select().from(events).where(eq(events.id, participant.eventId));
    const updated = await organiserOverride(
      event,
      participant,
      req.user!.macUserId,
      parsed.data.note,
      parsed.data.ticketId,
    );
    res.json({ participant: { id: updated.id, verificationStatus: updated.verificationStatus } });
  },
);
