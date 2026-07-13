CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'verified', 'revoked', 'override');--> statement-breakpoint
CREATE TYPE "public"."verified_via" AS ENUM('email_match', 'order_reference', 'exec_override');--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"mac_user_id" text NOT NULL,
	"display_name" text,
	"university" text,
	"study_level" text,
	"dietary" text,
	"github_handle" text,
	"discord_handle" text,
	"looking_for_team" boolean DEFAULT false NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_via" "verified_via",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_event_user_unique" ON "participants" USING btree ("event_id","mac_user_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_claimed_by_participant_id_participants_id_fk" FOREIGN KEY ("claimed_by_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;