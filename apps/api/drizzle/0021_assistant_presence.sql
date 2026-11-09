ALTER TABLE "automations" ADD COLUMN "running_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "turn_step" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "seen_at" timestamp with time zone;