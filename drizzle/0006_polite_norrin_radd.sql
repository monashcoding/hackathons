DROP INDEX "teams_event_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "teams_event_name_unique" ON "teams" USING btree ("event_id",lower("name")) WHERE "teams"."status" <> 'withdrawn';