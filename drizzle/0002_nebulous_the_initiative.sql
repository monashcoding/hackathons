CREATE TYPE "public"."ticket_status" AS ENUM('complete', 'cancelled', 'refunded', 'unknown');--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"humanitix_ticket_id" text NOT NULL,
	"humanitix_order_id" text,
	"order_reference" text,
	"ticket_type_name" text,
	"attendee_first_name" text,
	"attendee_last_name" text,
	"attendee_email_normalised" text,
	"status" "ticket_status" DEFAULT 'unknown' NOT NULL,
	"claimed_by_participant_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_humanitix_ticket_unique" ON "tickets" USING btree ("humanitix_ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_claim_unique" ON "tickets" USING btree ("claimed_by_participant_id") WHERE "tickets"."claimed_by_participant_id" is not null;--> statement-breakpoint
CREATE INDEX "tickets_event_idx" ON "tickets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "tickets_order_ref_idx" ON "tickets" USING btree ("event_id","order_reference");--> statement-breakpoint
CREATE INDEX "tickets_email_idx" ON "tickets" USING btree ("event_id","attendee_email_normalised");