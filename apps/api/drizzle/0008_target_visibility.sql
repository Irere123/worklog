ALTER TABLE "delivery_targets" ADD COLUMN "visibility" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "team_body" text;