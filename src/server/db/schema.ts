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
// participants
//
// One row per signed-in human per event. `mac_user_id` (the JWT sub) is the
// canonical user key. The event is open to everyone — `university` is
// self-declared free text, NOT inferred from the email domain, and isMonash
// never gates anything.
//
// verification_status is the heart of the platform: a participant is only
// "in the hackathon" once they hold a verified (or organiser-overridden) ticket.
// ---------------------------------------------------------------------------
export const verificationStatus = pgEnum("verification_status", [
  "unverified",
  "verified",
  "revoked",
  "override",
]);
export const verifiedVia = pgEnum("verified_via", [
  "email_match",
  "order_reference",
  "exec_override",
]);

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    macUserId: text("mac_user_id").notNull(),

    displayName: text("display_name"),
    university: text("university"), // free text, self-declared
    studyLevel: text("study_level"),
    dietary: text("dietary"),
    githubHandle: text("github_handle"),
    discordHandle: text("discord_handle"),

    lookingForTeam: boolean("looking_for_team").notNull().default(false),

    verificationStatus: verificationStatus("verification_status").notNull().default("unverified"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedVia: verifiedVia("verified_via"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One participant row per human per event.
    userEventUnique: uniqueIndex("participants_event_user_unique").on(
      table.eventId,
      table.macUserId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// teams / team_members / invites
//
// Status is DERIVED, never wished into existence (spec §9) — see teams/status.ts.
// A participant is in at most one non-withdrawn team per event; because a
// participant row is already event-scoped, a partial unique index on
// team_members(participant_id) WHERE accepted enforces that in the DB.
// Nothing is hard-deleted: leaving/removal/withdrawal are status flips.
// ---------------------------------------------------------------------------
export const teamStatus = pgEnum("team_status", [
  "forming",
  "confirmed",
  "flagged",
  "withdrawn",
]);
export const teamRole = pgEnum("team_role", ["lead", "member"]);
export const membershipStatus = pgEnum("membership_status", [
  "invited",
  "accepted",
  "declined",
  "removed",
]);
export const inviteStatus = pgEnum("invite_status", [
  "pending",
  "accepted",
  "declined",
  "revoked",
  "expired",
]);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    name: text("name").notNull(),
    leadParticipantId: uuid("lead_participant_id")
      .notNull()
      .references(() => participants.id),
    // Unguessable, revocable, regenerable. Optional max-uses/expiry.
    inviteCode: text("invite_code").notNull(),
    inviteCodeMaxUses: integer("invite_code_max_uses"),
    inviteCodeUses: integer("invite_code_uses").notNull().default(0),
    inviteCodeExpiresAt: timestamp("invite_code_expires_at", { withTimezone: true }),
    status: teamStatus("status").notNull().default("forming"),
    devpostNote: text("devpost_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Name unique per event, case-insensitive.
    nameUnique: uniqueIndex("teams_event_name_unique").on(table.eventId, sql`lower(${table.name})`),
    codeUnique: uniqueIndex("teams_invite_code_unique").on(table.inviteCode),
  }),
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    role: teamRole("role").notNull().default("member"),
    membershipStatus: membershipStatus("membership_status").notNull().default("invited"),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => ({
    teamParticipantUnique: uniqueIndex("team_members_team_participant_unique").on(
      table.teamId,
      table.participantId,
    ),
    // At most one ACCEPTED team per participant (participant is event-scoped).
    oneAcceptedPerParticipant: uniqueIndex("team_members_one_accepted_per_participant")
      .on(table.participantId)
      .where(sql`${table.membershipStatus} = 'accepted'`),
    byParticipant: index("team_members_participant_idx").on(table.participantId),
  }),
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    // Addressed to an EMAIL, not a user — the invitee may have no account yet.
    // Resolved against the signing-in user's email on first sign-in.
    emailNormalised: text("email_normalised").notNull(),
    status: inviteStatus("status").notNull().default("pending"),
    invitedByParticipantId: uuid("invited_by_participant_id").references(() => participants.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byEmail: index("invites_email_idx").on(table.emailNormalised, table.status),
    byTeam: index("invites_team_idx").on(table.teamId),
  }),
);

// ---------------------------------------------------------------------------
// custom_fields / custom_field_responses
//
// Per-event, organiser-defined questions (dietary, t-shirt size, track, "how did
// you hear about us"). A field applies to a participant or to a team. REQUIRED
// fields block team confirmation (spec §9) — folded into teams/status.ts.
// Fields are archived, never hard-deleted, so historical responses stay valid.
// ---------------------------------------------------------------------------
export const customFieldType = pgEnum("custom_field_type", [
  "text",
  "select",
  "multiselect",
  "checkbox",
]);
export const customFieldAppliesTo = pgEnum("custom_field_applies_to", ["participant", "team"]);

export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    label: text("label").notNull(),
    type: customFieldType("type").notNull(),
    options: jsonb("options").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    required: boolean("required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    appliesTo: customFieldAppliesTo("applies_to").notNull().default("participant"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byEvent: index("custom_fields_event_idx").on(table.eventId, table.appliesTo),
  }),
);

export const customFieldResponses = pgTable(
  "custom_field_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customFieldId: uuid("custom_field_id")
      .notNull()
      .references(() => customFields.id),
    // Exactly one of these is set, matching the field's applies_to.
    participantId: uuid("participant_id").references(() => participants.id),
    teamId: uuid("team_id").references(() => teams.id),
    value: jsonb("value").$type<unknown>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One response per field per subject — enables upsert.
    perParticipant: uniqueIndex("cfr_field_participant_unique")
      .on(table.customFieldId, table.participantId)
      .where(sql`${table.participantId} is not null`),
    perTeam: uniqueIndex("cfr_field_team_unique")
      .on(table.customFieldId, table.teamId)
      .where(sql`${table.teamId} is not null`),
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

    // One ticket, one human. No sharing. FK to participants(id) — released back
    // to NULL on revocation so a transferee can claim it. The partial-unique
    // index below enforces the invariant in the DB, not just in app code.
    claimedByParticipantId: uuid("claimed_by_participant_id").references(
      () => participants.id,
    ),

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
export type Participant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type CustomField = typeof customFields.$inferSelect;
export type CustomFieldResponse = typeof customFieldResponses.$inferSelect;
