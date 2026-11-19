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
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  /** Days untouched before active cards drift to "Not now". */
  entropyDays: integer("entropy_days").notNull().default(30),
  cardSeq: integer("card_seq").notNull().default(0),
  createdAt: createdAt(),
});

export const MEMBER_KINDS = ["human", "agent"] as const;
export const ROLES = ["owner", "admin", "member"] as const;

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
    /** Their own picture, or the first one a linked account or sign-in brought; never replaced unasked. */
    avatarUrl: text("avatar_url"),
    ownerId: text("owner_id"),
    agentProvider: text("agent_provider"),
    /** Null for agents and not-yet-claimed invites. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    settings: jsonb("settings").$type<MemberSettings>().notNull().default({}),
    /** Signs an unclaimed member's invite link; a new one voids the links made before. */
    inviteNonce: text("invite_nonce"),
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

export const identities = pgTable(
  "identities",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Null = seen in events but not matched to a member. */
    memberId: text("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    /** Provider's stable id; `handle:<login>` when only a login is known. */
    externalId: text("external_id").notNull(),
    externalHandle: text("external_handle"),
    displayName: text("display_name"),
    isBot: boolean("is_bot").notNull().default(false),
    avatarUrl: text("avatar_url"),
    /** From the provider's directory (Slack users.info), so a verified address can link it to a member. */
    email: text("email"),
    enrichedAt: ts("enriched_at"),
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
    index("identities_handle_idx")
      .on(t.workspaceId, t.provider, sql`lower(${t.externalHandle})`)
      .concurrently(),
  ]
);

export const API_SCOPES = ["read", "write", "ingest"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  name: text("name").notNull(),
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

/**
 * A coding agent that connected itself over MCP: one per person, workspace and OAuth client, so
 * Claude Code approved by two people is two agents, each working for its own person. The agent
 * member is created on the client's first call; deactivating it is how a connection ends.
 */
export const agentConnections = pgTable(
  "agent_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => members.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => members.id),
    /** A metadata-document URL, whose domain vouches for the client, or a self-registered id. */
    clientId: text("client_id").notNull(),
    lastUsedAt: ts("last_used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("agent_connections_client_uq").on(
      t.workspaceId,
      t.ownerId,
      t.clientId
    ),
    index("agent_connections_agent_idx").on(t.agentId),
  ]
);

/** Open-ended: the connector registry decides which ids exist. */
export type Provider = string;

/**
 * pending: installed but not yet linked; suspended: paused at the provider (GitHub suspend);
 * revoked: uninstalled or its token stopped working. Only active connections ingest.
 */
export const CONNECTION_STATUSES = [
  "pending",
  "active",
  "paused",
  "suspended",
  "revoked",
] as const;

export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: CONNECTION_STATUSES })
      .notNull()
      .default("active"),
    statusReason: text("status_reason"),
    /**
     * The provider-side account the instance's app is installed on (a GitHub installation id, a
     * Slack team id), which routes its webhooks here. Null for hand-configured connections.
     */
    externalId: text("external_id"),
    installedById: text("installed_by_id").references(() => members.id, {
      onDelete: "set null",
    }),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** AES-GCM sealed JSON. */
    secrets: text("secrets").notNull(),
    lastEventAt: ts("last_event_at"),
    /** Deliveries refused before they were stored: a wrong secret shows up here and nowhere else. */
    rejections: integer("rejections").notNull().default(0),
    lastRejectedAt: ts("last_rejected_at"),
    lastRejection: text("last_rejection"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("connections_external_uq")
      .on(t.provider, t.externalId)
      .concurrently(),
  ]
);

/**
 * The instance's own registration with a provider (a GitHub App, a Slack app), created once and
 * shared by every workspace that installs it. A provider app has one webhook URL, so it can't be
 * shared between instances.
 */
export const connectorApps = pgTable("connector_apps", {
  provider: text("provider").primaryKey(),
  /** GitHub App id, Slack app id, Discord application id. */
  appId: text("app_id"),
  /** GitHub's URL name for the app, used in install links. */
  slug: text("slug"),
  name: text("name"),
  /** AES-GCM sealed JSON: client secret, webhook or signing secret, private key. */
  credentials: text("credentials").notNull(),
  createdVia: text("created_via", {
    enum: ["env", "manifest", "manual"],
  }).notNull(),
  /** Deliveries for installations no connection claims. */
  unrouted: integer("unrouted").notNull().default(0),
  lastUnroutedAt: ts("last_unrouted_at"),
  /** Deliveries whose signature the app's secret didn't verify: a secret that doesn't match. */
  rejections: integer("rejections").notNull().default(0),
  lastRejectedAt: ts("last_rejected_at"),
  lastRejection: text("last_rejection"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * One row per in-flight install or app creation, bound to the admin who started it. The token
 * itself is never stored, only its hash, and the row is deleted when it is used.
 */
export const installStates = pgTable("install_states", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  purpose: text("purpose", { enum: ["install"] }).notNull(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

/** Where a sync stream (one repo's history, one channel's messages) has read up to. */
export const connectionCursors = pgTable(
  "connection_cursors",
  {
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    stream: text("stream").notNull(),
    cursor: jsonb("cursor")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    state: text("state", { enum: ["idle", "running", "failed"] })
      .notNull()
      .default("idle"),
    error: text("error"),
    syncedAt: ts("synced_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.stream] })]
);

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
    via: text("via", { enum: ["webhook", "app", "push", "sync"] })
      .notNull()
      .default("webhook"),
    /** The repo or channel it concerns. Deliveries in one partition are processed in order. */
    partitionKey: text("partition_key").notNull().default(""),
    /** Which of the connection's ordered queues processes it, derived from the partition. */
    lane: smallint("lane").notNull().default(0),
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
    /** When a failed delivery is tried again; null once it has used up its attempts. */
    retryAt: ts("retry_at"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("inbound_delivery_uq").on(t.connectionId, t.deliveryId),
    index("inbound_connection_time_idx").on(t.connectionId, t.receivedAt),
    index("inbound_waiting_idx")
      .on(t.connectionId, t.lane, t.receivedAt)
      .concurrently()
      .where(sql`${t.status} in ('pending', 'failed')`),
  ]
);

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
    connectionId: text("connection_id").references(() => connections.id, {
      onDelete: "set null",
    }),
    inboundEventId: text("inbound_event_id"),
    actorIdentityId: text("actor_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    onBehalfOfId: text("on_behalf_of_id").references(() => members.id, {
      onDelete: "set null",
    }),
    agentState: text("agent_state", {
      enum: ["working", "needs_you", "finished", "failed"],
    }),
    threadKey: text("thread_key"),
    /** 0..1. */
    importance: real("importance").notNull().default(0.5),
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

/**
 * Every source event that produced something, merged or not. An activity row only carries the id
 * of the first event merged into it, so this is what makes a retried delivery, a redelivery or a
 * backfill of an event already folded into a burst a no-op. Deleting an activity deletes its
 * entries, so a replay can rebuild it.
 */
export const ingestedEvents = pgTable(
  "ingested_events",
  {
    workspaceId: text("workspace_id").notNull(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    connectionId: text("connection_id").references(() => connections.id, {
      onDelete: "cascade",
    }),
    /**
     * Null for hidden events (signals and board effects only) and for deletions. The reference
     * is checked at commit (migration 0012), so a claim can name the activity about to be written;
     * changing it here would drop that.
     */
    activityId: text("activity_id").references(() => activities.id, {
      onDelete: "cascade",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.source, t.externalId] }),
    index("ingested_events_activity_idx").on(t.activityId),
    index("ingested_events_connection_idx").on(t.connectionId, t.createdAt),
  ]
);

export const ATTENTION_STATES = [
  "open",
  "done",
  "dismissed",
  "snoozed",
] as const;
export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];
/** The attention items an assistant raises to ask its owner before a write the review held back. */
export const APPROVAL_KIND = "assistant.approval";

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
    /**
     * When the source event that last raised it happened. A resolve closes only what was raised
     * before it, so a late one can't close a newer request.
     */
    sourceAt: ts("source_at"),
    /** When the proactive check last evaluated it (reset when something new happens on it). */
    consideredAt: ts("considered_at"),
    disposition: text("disposition", { enum: ["push", "digest", "drop"] }),
    reason: text("reason"),
    /** Last time it was actually pushed to the person (drives the per-thread cooldown). */
    pushedAt: ts("pushed_at"),
    digestedAt: ts("digested_at"),
    actedAt: ts("acted_at"),
    actions: jsonb("actions").$type<{ id: string; label: string }[]>(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("attention_dedupe_uq").on(t.memberId, t.dedupeKey),
    index("attention_member_state_idx").on(t.memberId, t.state),
    index("attention_open_thread_idx")
      .on(t.workspaceId, t.dedupeKey)
      .concurrently()
      .where(sql`${t.state} = 'open'`),
  ]
);

/**
 * When a thread's request was last resolved, by source time. A request that arrives after its
 * resolution (out of order, a retry, a backfill) but happened before it must not reopen anything,
 * even if no item existed when the resolve was processed. `memberId` is empty when it was resolved
 * for everyone, as closing a PR does.
 */
export const attentionResolutions = pgTable(
  "attention_resolutions",
  {
    workspaceId: text("workspace_id").notNull(),
    memberId: text("member_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    resolvedThrough: ts("resolved_through").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.dedupeKey, t.memberId] }),
    index("attention_resolutions_time_idx").on(t.resolvedThrough),
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

export const EVENT_TYPES = [
  "activity.created",
  "activity.updated",
  "card.updated",
  "attention.updated",
  "brief.created",
  "message.created",
  "automation.ran",
  "notification.sent",
  "assistant.updated",
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
  /** private = only the member reads it, so private data may go there; team = others might. */
  visibility: text("visibility", { enum: VISIBILITY })
    .notNull()
    .default("team"),
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
/** Routines that keep the assistant itself in shape: they deliver nothing anyone waits for. */
export const UPKEEP_KINDS: readonly AutomationKind[] = ["check", "consolidate"];

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
    instructions: text("instructions"),
    state: jsonb("state").$type<AutomationState>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: ts("next_run_at"),
    /**
     * When the scheduler queued its run, which the run clears: a job that finds another value here
     * was overtaken (by a retry after the run finished, or a later claim) and does nothing.
     */
    claimedAt: ts("claimed_at"),
    lastRunAt: ts("last_run_at"),
    lastStatus: text("last_status"),
    /**
     * Set while a run is underway, so the assistant can show it's at work. A worker that dies
     * mid-run leaves it set: readers ignore one older than the longest run.
     */
    runningSince: ts("running_since"),
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
    /** The version team-visible targets got, built from team-visible data only; null if none did. */
    teamBody: text("team_body"),
    reason: text("reason"),
    deliveredTo: text("delivered_to").array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_member_idx").on(t.memberId, t.createdAt)]
);

export const MEMORY_KINDS = ["profile", "fact", "journal", "digest"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * What a line was learned from. Activity is cited by id, so checking the line reads the record as
 * it stands now. What the owner said is quoted, since the message it came from may not be stored
 * yet when the assistant remembers it mid-turn.
 */
export type MemoryEvidence =
  | { kind: "activity"; id: string }
  | { kind: "said"; at: string; text: string };

/** Visibility is enforced in queries, not in prompts. */
export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    /**
     * profile = how they work / what they own; fact = durable knowledge; journal = one entry per day;
     * digest = a model-written page of all of it, rebuilt nightly, that every conversation starts with.
     */
    kind: text("kind", { enum: MEMORY_KINDS }).notNull(),
    content: text("content").notNull(),
    /** Other words for what the memory is about (synonyms, @handles, #card numbers), so recall finds it. */
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    visibility: text("visibility", { enum: VISIBILITY })
      .notNull()
      .default("team"),
    status: text("status", { enum: ["active", "superseded"] })
      .notNull()
      .default("active"),
    /** The line that replaced this one; null while active, and when it was forgotten rather than replaced. */
    supersededBy: text("superseded_by"),
    day: date("day"),
    source: text("source", { enum: ["self", "agent", "teammate"] }).notNull(),
    /**
     * False for an inference the evidence doesn't state outright ("seems to prefer mornings"):
     * recall still finds it, marked, but it stays out of the digest every conversation starts with.
     */
    confirmed: boolean("confirmed").notNull().default(true),
    evidence: jsonb("evidence")
      .$type<MemoryEvidence[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Time-bound knowledge ("on leave until Friday") stops being recalled after this. */
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("memories_member_idx").on(t.memberId, t.kind, t.status),
    index("memories_superseded_by_idx")
      .on(t.supersededBy)
      .concurrently()
      .where(sql`${t.supersededBy} is not null`),
  ]
);

/**
 * How a member wants their assistant to speak for them, in their own words. Only the member writes
 * it, never the assistant. Every save is a new row: the newest is current, the rest are history.
 */
export const voices = pgTable(
  "voices",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("voices_member_idx").on(t.memberId, t.createdAt)]
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => members.id),
    askerId: text("asker_id")
      .notNull()
      .references(() => members.id),
    /** owner = the agent's own human (full access); teammate = read-only, team-visible data only. */
    mode: text("mode", { enum: ["owner", "teammate"] }).notNull(),
    inbox: boolean("inbox").notNull().default(false),
    title: text("title"),
    /** Summary of the messages up to `recapThroughSeq`, which are no longer replayed to the model. */
    recap: text("recap"),
    recapThroughSeq: integer("recap_through_seq").notNull().default(0),
    /** The last message the assistant has learned from, once the conversation went quiet. */
    learnedThroughSeq: integer("learned_through_seq").notNull().default(0),
    /**
     * The memory page the conversation's instructions carry, kept as it was until the next summary
     * so the prompt's cached start doesn't change under it; null until the first turn takes it.
     */
    memoryPage: text("memory_page"),
    /** How far the conversation has been told about memory changing since its page was taken. */
    memorySeenAt: ts("memory_seen_at"),
    /** When a client last had the prompt prepared ahead of a message, to warm the provider's cache. */
    warmedAt: ts("warmed_at"),
    /** Set while a turn runs, so turns take their turn; a lease, in case the process dies mid-turn. */
    turnUntil: ts("turn_until"),
    /** Set to a running turn's lease to ask it to stop; the turn checks while it waits on the model. */
    turnStopUntil: ts("turn_stop_until"),
    /** What the running turn is doing now, for the assistant's presence; cleared with the turn. */
    turnStep: jsonb("turn_step").$type<TurnStep>(),
    /** When the assistant last wrote here, which is news until the asker has seen it. */
    repliedAt: ts("replied_at"),
    /** When the asker last had the conversation open. */
    seenAt: ts("seen_at"),
    /** Who's waiting for a turn, in the order they came: `<ms since epoch>:<id>`. */
    turnQueue: text("turn_queue")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("conversations_asker_idx").on(t.askerId, t.updatedAt),
    index("conversations_turning_idx")
      .on(t.agentId)
      .where(sql`${t.turnUntil} is not null`)
      .concurrently(),
  ]
);

export type TurnStep = {
  tool: string;
  input: Record<string, unknown>;
  at: string;
};

export type TurnUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

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
    /** Null for tool messages. */
    text: text("text"),
    /** The id the client gave the message it sent, so sending it again gets the same answer. */
    clientId: text("client_id"),
    /** On the last message of a turn: what the turn cost, and how much of it the cache served. */
    usage: jsonb("usage").$type<TurnUsage>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_seq_uq").on(t.conversationId, t.seq),
    uniqueIndex("messages_client_uq")
      .on(t.conversationId, t.clientId)
      .concurrently()
      .where(sql`${t.clientId} is not null`),
  ]
);

export const REPLY_RATINGS = ["helpful", "unhelpful"] as const;

/**
 * What the person in a conversation thought of one of the assistant's replies. In their own
 * conversations, owners' ratings are learned from like anything else they say; every rating is
 * also a case to check prompt and model changes against.
 */
export const replyRatings = pgTable(
  "reply_ratings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    rating: text("rating", { enum: REPLY_RATINGS }).notNull(),
    note: text("note"),
    /** When the memory pass read it; a changed rating is read again. */
    learnedAt: ts("learned_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reply_ratings_message_uq").on(t.messageId, t.memberId),
    index("reply_ratings_member_idx").on(t.memberId, t.createdAt),
  ]
);
