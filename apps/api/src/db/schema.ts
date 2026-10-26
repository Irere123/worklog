import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ---------------------------------------------------------------------------
// Tenancy, people and agents
// ---------------------------------------------------------------------------

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  /** Fizzy-style entropy: active cards untouched this long drift to "Not now". Boards may override. */
  entropyDays: integer("entropy_days").notNull().default(30),
  /** Card numbers are per workspace (#1, #2, ...), like Fizzy. */
  cardSeq: integer("card_seq").notNull().default(0),
  createdAt: createdAt(),
});

export const MEMBER_KINDS = ["human", "agent"] as const;
export const ROLES = ["owner", "admin", "member"] as const;

/**
 * Humans and agents are both members: agents can own cards, comment, log work and be asked
 * questions. Every human gets a personal assistant agent (ownerId = the human).
 * External agents (Claude Code, Devin, OpenClaw, CI bots...) are agents with an agentProvider.
 */
export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    kind: text("kind", { enum: MEMBER_KINDS }).notNull(),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    email: text("email"),
    title: text("title"),
    timezone: text("timezone"),
    ownerId: text("owner_id"),
    agentProvider: text("agent_provider"),
    /** The signed-in person (Better Auth user) behind a human member; null for agents and not-yet-claimed invites. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    settings: jsonb("settings").$type<MemberSettings>().notNull().default({}),
    createdAt: createdAt(),
    deactivatedAt: ts("deactivated_at"),
  },
  (t) => [
    uniqueIndex("members_handle_uq").on(t.workspaceId, t.handle),
    uniqueIndex("members_user_uq").on(t.workspaceId, t.userId),
    index("members_owner_idx").on(t.ownerId),
    index("members_email_idx").on(t.email),
  ]
);

export type MemberSettings = {
  /** Local working hours; proactive pings outside them wait for the next brief or digest. */
  activeHours?: { start: string; end: string };
  workdays?: number[];
  /** Interruption budget. Defaults: 4 pushes/day, 90 min apart, 4 h cooldown per thread. */
  notify?: {
    dailyPushCap?: number;
    minGapMinutes?: number;
    threadCooldownHours?: number;
  };
};

/**
 * Accounts on other platforms (GitHub user, Slack user, GitLab user...). Every actor the ingestion
 * pipeline sees gets a row — matched to a member or not. Linking an unmatched identity later
 * re-attributes all of its past activity, so nothing is lost while people aren't set up yet.
 */
export const identities = pgTable(
  "identities",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** null = seen in events but not matched to anyone yet. */
    memberId: text("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    /** Stable id from the provider (GitHub numeric id, Slack U…, GitLab id); falls back to `handle:<login>` when only a login is known. */
    externalId: text("external_id").notNull(),
    externalHandle: text("external_handle"),
    displayName: text("display_name"),
    isBot: boolean("is_bot").notNull().default(false),
    eventCount: integer("event_count").notNull().default(0),
    firstSeenAt: ts("first_seen_at"),
    lastSeenAt: ts("last_seen_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("identities_ext_uq").on(
      t.workspaceId,
      t.provider,
      t.externalId
    ),
    index("identities_member_idx").on(t.memberId),
  ]
);

export const API_SCOPES = ["read", "write", "ingest"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/**
 * API keys for agents, bots, scripts and integrations (humans use sign-in sessions). Each key acts as
 * one member, with scopes: read (GET), write (other changes), ingest (report activity / logs only).
 */
export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  name: text("name").notNull(),
  /** First characters of the key, shown in lists so people can tell keys apart. */
  prefix: text("prefix").notNull().default(""),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes", { enum: API_SCOPES })
    .array()
    .notNull()
    .default(sql`'{read,write}'::text[]`),
  expiresAt: ts("expires_at"),
  lastUsedAt: ts("last_used_at"),
  createdAt: createdAt(),
  revokedAt: ts("revoked_at"),
});

// ---------------------------------------------------------------------------
// Connectors (GitHub, Slack, Discord...)
// ---------------------------------------------------------------------------

/** Connector ids are open-ended (the registry decides what exists); these ship built in. */
export type Provider = string;

export const connections = pgTable("connections", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "paused"] })
    .notNull()
    .default("active"),
  /** Non-secret settings, e.g. { boardId, channels }. */
  settings: jsonb("settings")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  /** AES-GCM sealed JSON of secrets (webhook secret, bot token...). */
  secrets: text("secrets").notNull(),
  lastEventAt: ts("last_event_at"),
  createdAt: createdAt(),
});

/**
 * The raw inbox: every delivery from every connector is stored before it's interpreted, so ingestion
 * is idempotent (provider retries are no-ops), auditable ("why didn't this show up?"), and replayable
 * after a connector bug is fixed.
 */
export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: text("status", {
      enum: ["pending", "processed", "ignored", "failed"],
    })
      .notNull()
      .default("pending"),
    /** What the pipeline did with it: kept / merged / dropped (with reasons). */
    outcome: jsonb("outcome").$type<Record<string, unknown>>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("inbound_delivery_uq").on(t.connectionId, t.deliveryId),
    index("inbound_connection_time_idx").on(t.connectionId, t.receivedAt),
  ]
);

/** A small Postgres job queue (FOR UPDATE SKIP LOCKED), so any number of workers can drain it. */
export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** Jobs with the same key run one at a time, in order (e.g. one connection's deliveries). */
    orderingKey: text("ordering_key"),
    status: text("status", { enum: ["queued", "running", "done", "dead"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedUntil: ts("locked_until"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("jobs_due_idx").on(t.status, t.runAt),
    index("jobs_ordering_idx").on(t.orderingKey, t.id),
  ]
);

// ---------------------------------------------------------------------------
// The board (Fizzy-inspired): Maybe? -> your columns -> Not now / Done
// ---------------------------------------------------------------------------

export const boards = pgTable("boards", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name").notNull(),
  description: text("description"),
  /** Overrides workspace entropy; null = inherit. */
  entropyDays: integer("entropy_days"),
  createdById: text("created_by_id").references(() => members.id),
  createdAt: createdAt(),
  archivedAt: ts("archived_at"),
});

export const columns = pgTable(
  "columns",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    name: text("name").notNull(),
    color: text("color").notNull().default("gray"),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("columns_board_idx").on(t.boardId, t.position)]
);

/** triage = "Maybe?", active = in one of the board's columns, not_now = postponed, done = closed. */
export const CARD_STAGES = ["triage", "active", "not_now", "done"] as const;
export type CardStage = (typeof CARD_STAGES)[number];

export const cards = pgTable(
  "cards",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    stage: text("stage", { enum: CARD_STAGES }).notNull().default("triage"),
    columnId: text("column_id").references(() => columns.id),
    golden: boolean("golden").notNull().default(false),
    dueOn: date("due_on"),
    createdById: text("created_by_id").references(() => members.id),
    source: text("source").notNull().default("worklog"),
    /** e.g. "github:acme/api#42" — lets connectors find the card for an external item. */
    externalKey: text("external_key"),
    externalUrl: text("external_url"),
    lastActiveAt: ts("last_active_at").notNull().defaultNow(),
    postponedAt: ts("postponed_at"),
    autoPostponed: boolean("auto_postponed").notNull().default(false),
    closedAt: ts("closed_at"),
    closedById: text("closed_by_id").references(() => members.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cards_number_uq").on(t.workspaceId, t.number),
    uniqueIndex("cards_external_uq").on(t.workspaceId, t.externalKey),
    index("cards_board_stage_idx").on(t.boardId, t.stage),
  ]
);

export const cardAssignees = pgTable(
  "card_assignees",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    assignedAt: ts("assigned_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.memberId] }),
    index("card_assignees_member_idx").on(t.memberId),
  ]
);

/** Creators, assignees and commenters auto-watch a card; watchers get attention on activity. */
export const cardWatchers = pgTable(
  "card_watchers",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.memberId] })]
);

export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("tags_name_uq").on(t.workspaceId, t.name)]
);

export const cardTags = pgTable(
  "card_tags",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.tagId] })]
);

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => members.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("comments_card_idx").on(t.cardId)]
);

// ---------------------------------------------------------------------------
// The work stream: everything anyone (human or agent) did, from every source
// ---------------------------------------------------------------------------

export const VISIBILITY = ["team", "private"] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const activities = pgTable(
  "activities",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    actorId: text("actor_id").references(() => members.id),
    /** worklog | github | slack | discord | api */
    source: text("source").notNull(),
    /** e.g. card.created, card.closed, log.entry, log.decision, pr.merged, review.requested */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    cardId: text("card_id").references(() => cards.id, {
      onDelete: "set null",
    }),
    visibility: text("visibility", { enum: VISIBILITY })
      .notNull()
      .default("team"),
    externalId: text("external_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    /** Where it came from: the connection, the raw delivery, and the external account that did it. */
    connectionId: text("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    inboundEventId: text("inbound_event_id"),
    actorIdentityId: text("actor_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    /** For agent work: the human it was done for, and where it stands. */
    onBehalfOfId: text("on_behalf_of_id").references(() => members.id, {
      onDelete: "set null",
    }),
    agentState: text("agent_state", {
      enum: ["working", "needs_you", "finished", "failed"],
    }),
    /** Related events share a thread (e.g. every event on PR acme/api#7). */
    threadKey: text("thread_key"),
    /** 0..1 — how much this matters in briefs and summaries. */
    importance: real("importance").notNull().default(0.5),
    /** Bursts (commits, comments, messages) merge into one activity; count says how many. */
    coalesceKey: text("coalesce_key"),
    count: integer("count").notNull().default(1),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("activities_external_uq").on(
      t.workspaceId,
      t.source,
      t.externalId
    ),
    index("activities_ws_time_idx").on(t.workspaceId, t.occurredAt),
    index("activities_actor_time_idx").on(t.actorId, t.occurredAt),
    index("activities_card_idx").on(t.cardId),
    index("activities_thread_idx").on(t.workspaceId, t.threadKey),
    index("activities_coalesce_idx").on(
      t.workspaceId,
      t.coalesceKey,
      t.updatedAt
    ),
    index("activities_identity_idx").on(t.actorIdentityId),
  ]
);

// ---------------------------------------------------------------------------
// Attention: "this needs you" — collapsed per (member, dedupe key) like Fizzy notifications
// ---------------------------------------------------------------------------

export const ATTENTION_STATES = [
  "open",
  "done",
  "dismissed",
  "snoozed",
] as const;
export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const attentionItems = pgTable(
  "attention_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    cardId: text("card_id").references(() => cards.id, {
      onDelete: "set null",
    }),
    activityId: text("activity_id").references(() => activities.id, {
      onDelete: "set null",
    }),
    fromId: text("from_id").references(() => members.id),
    priority: text("priority", { enum: PRIORITIES })
      .notNull()
      .default("normal"),
    state: text("state", { enum: ATTENTION_STATES }).notNull().default("open"),
    snoozedUntil: ts("snoozed_until"),
    dedupeKey: text("dedupe_key").notNull(),
    count: integer("count").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
    /** When the proactive check last evaluated it (reset when something new happens on it). */
    consideredAt: ts("considered_at"),
    /** What the check decided: push now, hold for the next digest, or drop. */
    disposition: text("disposition", { enum: ["push", "digest", "drop"] }),
    /** One line on why — shown as "why am I seeing this". */
    reason: text("reason"),
    /** Last time it was actually pushed to the person (drives the per-thread cooldown). */
    pushedAt: ts("pushed_at"),
    /** Last time it was included in a brief or digest. */
    digestedAt: ts("digested_at"),
    /** When the person acted on it (done, or one of its actions). */
    actedAt: ts("acted_at"),
    /** One-click actions, e.g. [{ id: "keep", label: "Still on it" }]; executed via POST /attention/{id}/actions/{actionId}. */
    actions: jsonb("actions").$type<{ id: string; label: string }[]>(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("attention_dedupe_uq").on(t.memberId, t.dedupeKey),
    index("attention_member_state_idx").on(t.memberId, t.state),
  ]
);

export const FEEDBACK_SIGNALS = [
  "useful",
  "not_useful",
  "less_like_this",
] as const;

/** Explicit feedback on attention items; repeated "not useful" for a kind routes that kind to digests. */
export const attentionFeedback = pgTable(
  "attention_feedback",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    attentionId: text("attention_id").references(() => attentionItems.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    signal: text("signal", { enum: FEEDBACK_SIGNALS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("attention_feedback_member_idx").on(t.memberId, t.kind)]
);

// ---------------------------------------------------------------------------
// Realtime: durable, sequenced event log every client can replay (OpenCode v2 style)
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  "activity.created",
  "activity.updated",
  "card.updated",
  "attention.updated",
  "brief.created",
  "message.created",
  "automation.ran",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const events = pgTable(
  "events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    /** null = everyone in the workspace; otherwise only this member (and their agent). */
    audienceId: text("audience_id"),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("events_ws_seq_idx").on(t.workspaceId, t.seq)]
);

// ---------------------------------------------------------------------------
// Briefs, delivery and automations (proactive agent)
// ---------------------------------------------------------------------------

export const briefs = pgTable(
  "briefs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    period: text("period", { enum: ["daily", "weekly"] }).notNull(),
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    composedBy: text("composed_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("briefs_period_uq").on(t.memberId, t.period, t.periodStart),
  ]
);

export const TARGET_KINDS = ["email", "slack", "discord", "webhook"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** Where a member wants things delivered: an email address, a Slack channel/DM, a Discord channel, a webhook. */
export const deliveryTargets = pgTable("delivery_targets", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  kind: text("kind", { enum: TARGET_KINDS }).notNull(),
  label: text("label").notNull(),
  /** email address | Slack channel/user id | Discord channel id or webhook URL | https URL */
  address: text("address").notNull(),
  connectionId: text("connection_id").references(() => connections.id),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});

export const AUTOMATION_KINDS = [
  "brief.daily",
  "brief.weekly",
  "digest",
  "check",
  "consolidate",
  "custom",
] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

/**
 * Scheduled agent work, modelled as ordinary job rows (what OpenClaw converged on after retiring
 * its special "heartbeat"): the morning brief, the weekly wrap, the proactive attention check,
 * nightly memory consolidation, and user-written custom automations.
 */
export const automations = pgTable(
  "automations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    kind: text("kind", { enum: AUTOMATION_KINDS }).notNull(),
    name: text("name").notNull(),
    schedule: jsonb("schedule").$type<Schedule>().notNull(),
    /** Delivery targets; empty = in-app only (inbox + realtime). */
    targetIds: text("target_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Extra instructions / checklist for the agent (custom automations, tone for briefs). */
    instructions: text("instructions"),
    /** Per-automation scratch: watermarks, last meaningful result... */
    state: jsonb("state").$type<AutomationState>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: ts("next_run_at"),
    lastRunAt: ts("last_run_at"),
    lastStatus: text("last_status"),
    failureCount: integer("failure_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("automations_due_idx").on(t.enabled, t.nextRunAt)]
);

export type Schedule =
  | { type: "daily"; at: string; weekdays?: number[] }
  | { type: "weekly"; weekday: number; at: string }
  | { type: "interval"; minutes: number; activeHoursOnly?: boolean };

export type AutomationState = {
  watermark?: string;
  lastResult?: { status: string; summary: string; at: string };
};

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["skipped", "quiet", "delivered", "failed"],
    }).notNull(),
    summary: text("summary"),
    error: text("error"),
    startedAt: ts("started_at").notNull(),
    finishedAt: ts("finished_at").notNull().defaultNow(),
  },
  (t) => [index("automation_runs_idx").on(t.automationId, t.startedAt)]
);

/** Every proactive push, with what it contained and why — the basis for measuring push precision. */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    automationId: text("automation_id").references(() => automations.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    itemIds: text("item_ids").array().notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    reason: text("reason"),
    deliveredTo: text("delivered_to").array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_member_idx").on(t.memberId, t.createdAt)]
);

// ---------------------------------------------------------------------------
// Memory: what each person's agent knows about them (OpenClaw's USER.md / MEMORY.md /
// memory/YYYY-MM-DD.md, as rows with visibility enforced in queries, not prompts)
// ---------------------------------------------------------------------------

export const MEMORY_KINDS = ["profile", "fact", "journal"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** The human this memory is about. */
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    /** profile = how they work / what they own; fact = durable knowledge; journal = one entry per day. */
    kind: text("kind", { enum: MEMORY_KINDS }).notNull(),
    content: text("content").notNull(),
    visibility: text("visibility", { enum: VISIBILITY })
      .notNull()
      .default("team"),
    status: text("status", { enum: ["active", "superseded"] })
      .notNull()
      .default("active"),
    day: date("day"),
    source: text("source", { enum: ["self", "agent", "teammate"] }).notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("memories_member_idx").on(t.memberId, t.kind, t.status)]
);

// ---------------------------------------------------------------------------
// Conversations with agents
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** The agent being talked to. */
    agentId: text("agent_id")
      .notNull()
      .references(() => members.id),
    /** Who is talking to it. */
    askerId: text("asker_id")
      .notNull()
      .references(() => members.id),
    /** owner = the agent's own human (full access); teammate = read-only, team-visible data only. */
    mode: text("mode", { enum: ["owner", "teammate"] }).notNull(),
    /** The owner's inbox: briefs and proactive pings land here so replies have context. */
    inbox: boolean("inbox").notNull().default(false),
    title: text("title"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_asker_idx").on(t.askerId, t.updatedAt)]
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role", { enum: ["user", "assistant", "tool"] }).notNull(),
    /** The AI SDK ModelMessage, replayed verbatim (append-only history). */
    content: jsonb("content").$type<unknown>().notNull(),
    /** Plain text for display; null for tool messages. */
    text: text("text"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("messages_seq_uq").on(t.conversationId, t.seq)]
);

/** Leader lease so only one process runs the scheduler when several API replicas are up. */
export const leases = pgTable("leases", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  expiresAt: ts("expires_at").notNull(),
});
