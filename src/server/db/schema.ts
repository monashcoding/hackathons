import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// events
//
// Multi-event from day one. Everything else in the platform (participants,
// tickets, teams, content) is scoped to a row here. Next year's committee
// creates a new event in the admin UI — they never fork the repo.
//
// Timestamps are stored UTC and rendered in Melbourne local time in the UI.
// Registration open/close is always evaluated server-side; never trust client
// time for window checks.
// ---------------------------------------------------------------------------
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Human, URL-ish key, e.g. "2026". Unique across all events.
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),

    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    venue: text("venue"),

    registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
    registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),

    // MACATHON runs teams of 2–4, so a solo participant is never a valid team.
    minTeamSize: integer("min_team_size").notNull().default(2),
    maxTeamSize: integer("max_team_size").notNull().default(4),

    // The Humanitix event this maps to (stage 3). Nullable until sync is wired.
    humanitixEventId: text("humanitix_event_id"),

    // Ticket type names are per-event config — they change every year and must
    // never require a code change. Which type names count as a participant vs a
    // mentor/volunteer.
    participantTicketTypes: jsonb("participant_ticket_types")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    mentorTicketTypes: jsonb("mentor_ticket_types")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    devpostUrl: text("devpost_url"),

    isPublished: boolean("is_published").notNull().default(false),
    // Nothing is hard-deleted. Archiving hides an event; the row is preserved.
    isArchived: boolean("is_archived").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex("events_slug_unique").on(table.slug),
  }),
);

// ---------------------------------------------------------------------------
// audit_log
//
// Append-only. Every verification, override, revocation, team status change,
// sync run, and admin mutation lands here. Non-negotiable: nothing is
// hard-deleted anywhere in this platform, and every consequential action is
// traceable to an actor.
//
// actor_mac_user_id is nullable because system actions (cron sweeps) have no
// human actor.
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: some audited actions are event-global (e.g. event creation).
    eventId: uuid("event_id").references(() => events.id),
    actorMacUserId: text("actor_mac_user_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byEvent: index("audit_log_event_idx").on(table.eventId, table.createdAt),
  }),
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
