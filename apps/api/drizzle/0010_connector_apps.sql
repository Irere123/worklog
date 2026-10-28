CREATE TABLE "attention_resolutions" (
	"workspace_id" text NOT NULL,
	"member_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"resolved_through" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_resolutions_workspace_id_dedupe_key_member_id_pk" PRIMARY KEY("workspace_id","dedupe_key","member_id")
);
--> statement-breakpoint
CREATE TABLE "connection_cursors" (
	"connection_id" text NOT NULL,
	"stream" text NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'idle' NOT NULL,
	"error" text,
	"synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_cursors_connection_id_stream_pk" PRIMARY KEY("connection_id","stream")
);
--> statement-breakpoint
CREATE TABLE "connector_apps" (
	"provider" text PRIMARY KEY NOT NULL,
	"app_id" text,
	"slug" text,
	"name" text,
	"credentials" text NOT NULL,
	"created_via" text NOT NULL,
	"unrouted" integer DEFAULT 0 NOT NULL,
	"last_unrouted_at" timestamp with time zone,
	"rejections" integer DEFAULT 0 NOT NULL,
	"last_rejected_at" timestamp with time zone,
	"last_rejection" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingested_events" (
	"workspace_id" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"connection_id" text,
	"activity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingested_events_workspace_id_source_external_id_pk" PRIMARY KEY("workspace_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "install_states" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"purpose" text NOT NULL,
	"workspace_id" text NOT NULL,
	"member_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attention_items" ADD COLUMN "source_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "installed_by_id" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "rejections" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_rejection" text;--> statement-breakpoint
ALTER TABLE "identities" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "identities" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "via" text DEFAULT 'webhook' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "partition_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "lane" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connection_cursors" ADD CONSTRAINT "connection_cursors_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingested_events" ADD CONSTRAINT "ingested_events_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingested_events" ADD CONSTRAINT "ingested_events_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "install_states" ADD CONSTRAINT "install_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "install_states" ADD CONSTRAINT "install_states_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attention_resolutions_time_idx" ON "attention_resolutions" USING btree ("resolved_through");--> statement-breakpoint
CREATE INDEX "ingested_events_activity_idx" ON "ingested_events" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "ingested_events_connection_idx" ON "ingested_events" USING btree ("connection_id","created_at");--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_installed_by_id_members_id_fk" FOREIGN KEY ("installed_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;