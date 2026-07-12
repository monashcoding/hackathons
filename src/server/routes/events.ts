import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.ts";
import { events } from "../db/schema.ts";
import { recordAudit } from "../lib/audit.ts";
import { requireAuth, requireOrganiser, type AuthedRequest } from "../auth/middleware.ts";

export const eventsRouter = Router();

// Every route here is organiser-only, server-side. This is the admin CRUD that
// lets next year's committee stand up a new event without touching code.
eventsRouter.use(requireAuth, requireOrganiser);

// ISO datetime string -> Date, or null. Timestamps are UTC in the DB.
const dateField = z.string().datetime({ offset: true }).nullish();

// Shared shape. On create, `slug` and `name` are required; on update everything
// is optional (PATCH semantics). Team-size sanity is enforced with a refine.
const baseEventSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric/hyphen"),
  name: z.string().trim().min(1).max(200),
  tagline: z.string().trim().max(500).nullish(),
  startsAt: dateField,
  endsAt: dateField,
  venue: z.string().trim().max(300).nullish(),
  registrationOpensAt: dateField,
  registrationClosesAt: dateField,
  minTeamSize: z.number().int().min(1).max(20),
  maxTeamSize: z.number().int().min(1).max(20),
  humanitixEventId: z.string().trim().max(64).nullish(),
  participantTicketTypes: z.array(z.string().trim().min(1)),
  mentorTicketTypes: z.array(z.string().trim().min(1)),
  devpostUrl: z.string().trim().url().max(500).nullish(),
  isPublished: z.boolean(),
});

const createSchema = baseEventSchema
  .partial()
  .required({ slug: true, name: true })
  .refine(
    (v) => v.minTeamSize == null || v.maxTeamSize == null || v.minTeamSize <= v.maxTeamSize,
    { message: "minTeamSize must be <= maxTeamSize", path: ["minTeamSize"] },
  );

const updateSchema = baseEventSchema.partial().refine(
  (v) => v.minTeamSize == null || v.maxTeamSize == null || v.minTeamSize <= v.maxTeamSize,
  { message: "minTeamSize must be <= maxTeamSize", path: ["minTeamSize"] },
);

// Coerce the validated payload into DB column values. Strings -> Date for
// timestamp columns; undefined fields are simply omitted from the write.
function toColumns(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  for (const key of [
    "startsAt",
    "endsAt",
    "registrationOpensAt",
    "registrationClosesAt",
  ] as const) {
    if (key in out) {
      out[key] = out[key] == null ? null : new Date(out[key] as string);
    }
  }
  return out;
}

// GET /api/events — list all, including archived (organisers manage archives).
eventsRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(events).orderBy(asc(events.createdAt));
  res.json({ events: rows });
});

// GET /api/events/:id
eventsRouter.get("/:id", async (req, res) => {
  const [row] = await db.select().from(events).where(eq(events.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json({ event: row });
});

// POST /api/events — create.
eventsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid event", details: parsed.error.flatten() });
    return;
  }

  try {
    const [row] = await db
      .insert(events)
      .values(toColumns(parsed.data) as typeof events.$inferInsert)
      .returning();

    await recordAudit({
      eventId: row.id,
      actorMacUserId: req.user!.macUserId,
      action: "event.create",
      subjectType: "event",
      subjectId: row.id,
      detail: { slug: row.slug, name: row.name },
    });

    res.status(201).json({ event: row });
  } catch (err) {
    // Most likely a duplicate slug (unique index).
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "An event with that slug already exists" });
      return;
    }
    throw err;
  }
});

// PATCH /api/events/:id — partial update.
eventsRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid event", details: parsed.error.flatten() });
    return;
  }

  const columns = toColumns(parsed.data);
  if (Object.keys(columns).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  columns.updatedAt = new Date();

  try {
    const [row] = await db
      .update(events)
      .set(columns)
      .where(eq(events.id, req.params.id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    await recordAudit({
      eventId: row.id,
      actorMacUserId: req.user!.macUserId,
      action: "event.update",
      subjectType: "event",
      subjectId: row.id,
      detail: { fields: Object.keys(parsed.data) },
    });

    res.json({ event: row });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "An event with that slug already exists" });
      return;
    }
    throw err;
  }
});

// POST /api/events/:id/archive — soft-delete. Nothing is hard-deleted; the row
// is preserved and simply hidden. `archived: false` in the body un-archives.
eventsRouter.post("/:id/archive", async (req: AuthedRequest, res) => {
  const archived = req.body?.archived !== false; // default true
  const [row] = await db
    .update(events)
    .set({ isArchived: archived, updatedAt: new Date() })
    .where(eq(events.id, req.params.id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  await recordAudit({
    eventId: row.id,
    actorMacUserId: req.user!.macUserId,
    action: archived ? "event.archive" : "event.unarchive",
    subjectType: "event",
    subjectId: row.id,
  });

  res.json({ event: row });
});

// Postgres unique-violation SQLSTATE.
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
