ALTER TABLE "memories" ADD COLUMN "confirmed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;