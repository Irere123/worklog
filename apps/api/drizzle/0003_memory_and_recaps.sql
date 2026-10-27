ALTER TABLE "conversations" ADD COLUMN "recap" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "recap_through_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "expires_at" timestamp with time zone;