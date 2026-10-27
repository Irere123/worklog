-- Rewritten all day: an identity on every ingested event, a delivery when it is processed and again
-- when retention deletes it, attention items as they collapse and get considered, events by the
-- daily prune. Free space per page (fillfactor) lets an update that changes no indexed column stay
-- on its page without waiting for vacuum, and vacuum starts at 5% dead rows instead of 20%.
-- Setting storage parameters doesn't block reads or writes.
ALTER TABLE "identities" SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05);
--> statement-breakpoint
ALTER TABLE "inbound_events" SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05);
--> statement-breakpoint
ALTER TABLE "attention_items" SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05);
--> statement-breakpoint
ALTER TABLE "events" SET (autovacuum_vacuum_scale_factor = 0.05);
