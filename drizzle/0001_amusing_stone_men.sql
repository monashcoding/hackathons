CREATE TYPE "public"."content_kind" AS ENUM('prize', 'judge', 'schedule_item', 'sponsor', 'faq', 'page');--> statement-breakpoint
CREATE TYPE "public"."sync_source" AS ENUM('humanitix', 'notion');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('success', 'failed', 'aborted_safety');--> statement-breakpoint
CREATE TABLE "content_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"kind" "content_kind" NOT NULL,
	"notion_page_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_present" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "sync_source" NOT NULL,
	"event_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status" NOT NULL,
	"records_seen" integer DEFAULT 0 NOT NULL,
	"records_changed" integer DEFAULT 0 NOT NULL,
	"records_would_revoke" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_blocks_notion_page_unique" ON "content_blocks" USING btree ("notion_page_id");--> statement-breakpoint
CREATE INDEX "content_blocks_event_kind_idx" ON "content_blocks" USING btree ("event_id","kind");--> statement-breakpoint
CREATE INDEX "sync_runs_source_idx" ON "sync_runs" USING btree ("source","started_at");