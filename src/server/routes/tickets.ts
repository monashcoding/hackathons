import { Router, raw } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { events } from "../db/schema.ts";
import { isHumanitixConfigured } from "../env.ts";
import { runTicketSync } from "../tickets/sync.ts";
import { CsvTicketSource } from "../tickets/csv.ts";
import { recordAudit } from "../lib/audit.ts";
import { requireAuth, requireOrganiser, type AuthedRequest } from "../auth/middleware.ts";

export const ticketsRouter = Router();

// All ticket routes are organiser-only, server-side.
ticketsRouter.use(requireAuth, requireOrganiser);

async function loadEvent(id: string) {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  return row ?? null;
}

// POST /api/events/:id/tickets/sync — the "Sync now" button. Non-negotiable:
// the director needs it while standing next to a confused attendee.
ticketsRouter.post("/:id/tickets/sync", async (req: AuthedRequest, res) => {
  if (!isHumanitixConfigured) {
    res.status(503).json({ error: "Humanitix is not configured on this deployment" });
    return;
  }
  const event = await loadEvent(req.params.id);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!event.humanitixEventId) {
    res.status(400).json({ error: "Event has no Humanitix event id configured" });
    return;
  }

  const result = await runTicketSync(event); // Humanitix source (default)
  await recordAudit({
    eventId: event.id,
    actorMacUserId: req.user!.macUserId,
    action: "ticket.sync.manual",
    subjectType: "event",
    subjectId: event.id,
    detail: { ...result },
  });
  // A safety abort is a 200 with an explanatory body — the UI surfaces it loudly.
  res.json(result);
});

// POST /api/events/:id/tickets/import — the CSV fallback adapter. Same normalise
// + safety-gate path as the API. Body is the raw CSV (text/csv or text/plain).
ticketsRouter.post(
  "/:id/tickets/import",
  raw({ type: ["text/csv", "text/plain"], limit: "10mb" }),
  async (req: AuthedRequest, res) => {
    const event = await loadEvent(req.params.id);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    const csvText = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
    if (!csvText.trim()) {
      res.status(400).json({ error: "Empty CSV body" });
      return;
    }

    const result = await runTicketSync(event, new CsvTicketSource(csvText));
    await recordAudit({
      eventId: event.id,
      actorMacUserId: req.user!.macUserId,
      action: "ticket.sync.csv_import",
      subjectType: "event",
      subjectId: event.id,
      detail: { ...result },
    });
    res.json(result);
  },
);
