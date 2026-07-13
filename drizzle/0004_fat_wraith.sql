CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'declined', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'accepted', 'declined', 'removed');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('lead', 'member');--> statement-breakpoint
CREATE TYPE "public"."team_status" AS ENUM('forming', 'confirmed', 'flagged', 'withdrawn');--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"email_normalised" text NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"invited_by_participant_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'member' NOT NULL,
	"membership_status" "membership_status" DEFAULT 'invited' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lead_participant_id" uuid NOT NULL,
	"invite_code" text NOT NULL,
	"invite_code_max_uses" integer,
	"invite_code_uses" integer DEFAULT 0 NOT NULL,
	"invite_code_expires_at" timestamp with time zone,
	"status" "team_status" DEFAULT 'forming' NOT NULL,
	"devpost_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_participant_id_participants_id_fk" FOREIGN KEY ("invited_by_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_lead_participant_id_participants_id_fk" FOREIGN KEY ("lead_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_email_idx" ON "invites" USING btree ("email_normalised","status");--> statement-breakpoint
CREATE INDEX "invites_team_idx" ON "invites" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_participant_unique" ON "team_members" USING btree ("team_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_one_accepted_per_participant" ON "team_members" USING btree ("participant_id") WHERE "team_members"."membership_status" = 'accepted';--> statement-breakpoint
CREATE INDEX "team_members_participant_idx" ON "team_members" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_event_name_unique" ON "teams" USING btree ("event_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "teams_invite_code_unique" ON "teams" USING btree ("invite_code");