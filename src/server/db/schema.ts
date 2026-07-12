import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
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

// ---------------------------------------------------------------------------
// tickets
//
// A read-only mirror of Humanitix state. NEVER written back to Humanitix.
// Discovered field mapping lives in docs/humanitix-schema.md — notably, email
// is NOT on the ticket; it is joined from the order via orderId at sync time.
//
// `raw` persists the full API payload forever so future schema drift is
// debuggable. It may contain PII and must never be exposed through any
// participant-facing endpoint.
// ---------------------------------------------------------------------------
export const ticketStatus = pgEnum("ticket_status", [
  "complete",
  "cancelled",
  "refunded",
  "unknown",
]);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),

    // The ticket `_id` from the API. STABLE KEY. Unique across the whole table.
    humanitixTicketId: text("humanitix_ticket_id").notNull(),
    // The internal order `_id` (long Mongo-style id).
    humanitixOrderId: text("humanitix_order_id"),
    // The SHORT human-visible code (e.g. "5KEPWWRW") from `orderName` — what
    // attendees can actually find in their confirmation email.
    orderReference: text("order_reference"),

    ticketTypeName: text("ticket_type_name"),
    attendeeFirstName: text("attendee_first_name"),
    attendeeLastName: text("attendee_last_name"),
    attendeeEmailNormalised: text("attendee_email_normalised"),

    status: ticketStatus("status").notNull().default("unknown"),

    // One ticket, one human. No sharing. The FK to participants(id) lands in
    // stage 4 when that table exists; the column and its partial-unique index
    // are here now so claiming has a stable target and the invariant is in the DB.
    claimedByParticipantId: uuid("claimed_by_participant_id"),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),

    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (table) => ({
    ticketUnique: uniqueIndex("tickets_humanitix_ticket_unique").on(table.humanitixTicketId),
    // One ticket per participant: partial unique index over the non-null values.
    claimUnique: uniqueIndex("tickets_claim_unique")
      .on(table.claimedByParticipantId)
      .where(sql`${table.claimedByParticipantId} is not null`),
    byEvent: index("tickets_event_idx").on(table.eventId),
    byOrderRef: index("tickets_order_ref_idx").on(table.eventId, table.orderReference),
    byEmail: index("tickets_email_idx").on(table.eventId, table.attendeeEmailNormalised),
  }),
);

// ---------------------------------------------------------------------------
// content_blocks
//
// The Notion cache. We render Notion into Postgres and serve from Postgres —
// never live-proxy Notion on a page request. If Notion is down, or someone
// deletes a row at 2am the night before, the site keeps serving the last good
// snapshot.
//
// Keyed on notion_page_id (the stable Notion key). Never key on title/name —
// those get edited. `payload` holds the normalised, already-sanitised fields
// the public site renders; nothing raw from Notion reaches the browser.
// ---------------------------------------------------------------------------
export const contentKind = pgEnum("content_kind", [
  "prize",
  "judge",
  "schedule_item",
  "sponsor",
  "faq",
  "page",
]);

export const contentBlocks = pgTable(
  "content_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: a block may arrive before its event slug resolves to a row.
    // Such orphans are simply not served until the event exists.
    eventId: uuid("event_id").references(() => events.id),
    kind: contentKind("kind").notNull(),
    notionPageId: text("notion_page_id").notNull(),
    // Normalised + sanitised render-ready fields. See content/notion.ts.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // Notion's `Published` checkbox. Unpublished rows never appear on the site.
    isPublished: boolean("is_published").notNull().default(false),
    // Set to false when a page disappears from a Notion sweep (soft-delete —
    // nothing is hard-deleted). Distinct from Notion's Published checkbox.
    isPresent: boolean("is_present").notNull().default(true),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pageUnique: uniqueIndex("content_blocks_notion_page_unique").on(table.notionPageId),
    byEventKind: index("content_blocks_event_kind_idx").on(table.eventId, table.kind),
  }),
);

// ---------------------------------------------------------------------------
// sync_runs
//
// One row per sweep (Notion now, Humanitix in stage 3). Drives the "last
// successful sync" health banner — the single most important operational-
// visibility feature in the app. Written on every run, success or failure.
//
// records_would_revoke is Humanitix-only (the mass-revocation safety gate);
// it stays 0 for Notion runs.
// ---------------------------------------------------------------------------
export const syncSource = pgEnum("sync_source", ["humanitix", "notion"]);
export const syncStatus = pgEnum("sync_status", [
  "success",
  "failed",
  "aborted_safety",
]);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: syncSource("source").notNull(),
    eventId: uuid("event_id").references(() => events.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: syncStatus("status").notNull(),
    recordsSeen: integer("records_seen").notNull().default(0),
    recordsChanged: integer("records_changed").notNull().default(0),
    recordsWouldRevoke: integer("records_would_revoke").notNull().default(0),
    error: text("error"),
  },
  (table) => ({
    bySource: index("sync_runs_source_idx").on(table.source, table.startedAt),
  }),
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type ContentBlock = typeof contentBlocks.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
