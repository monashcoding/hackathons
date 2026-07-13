CREATE TYPE "public"."custom_field_applies_to" AS ENUM('participant', 'team');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'select', 'multiselect', 'checkbox');--> statement-breakpoint
CREATE TABLE "custom_field_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"custom_field_id" uuid NOT NULL,
	"participant_id" uuid,
	"team_id" uuid,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"applies_to" "custom_field_applies_to" DEFAULT 'participant' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_field_responses" ADD CONSTRAINT "custom_field_responses_custom_field_id_custom_fields_id_fk" FOREIGN KEY ("custom_field_id") REFERENCES "public"."custom_fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_responses" ADD CONSTRAINT "custom_field_responses_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_responses" ADD CONSTRAINT "custom_field_responses_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cfr_field_participant_unique" ON "custom_field_responses" USING btree ("custom_field_id","participant_id") WHERE "custom_field_responses"."participant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cfr_field_team_unique" ON "custom_field_responses" USING btree ("custom_field_id","team_id") WHERE "custom_field_responses"."team_id" is not null;--> statement-breakpoint
CREATE INDEX "custom_fields_event_idx" ON "custom_fields" USING btree ("event_id","applies_to");