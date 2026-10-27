import { z } from "@hono/zod-openapi";

import type { WorkSnapshot } from "#activity/snapshot";
import type { CardView } from "#board/service";
import type { ActivityRow } from "#db/queries/activities";
import type { AttentionItem } from "#db/queries/attention";
import type { Automation } from "#db/queries/automations";
import type { Column } from "#db/queries/boards";
import type { BriefRow } from "#db/queries/briefs";
import type { ConnectionRow } from "#db/queries/connections";
import type { ConversationRow, MessageRow } from "#db/queries/conversations";
import type { TargetRow } from "#db/queries/delivery-targets";
import type { Member } from "#db/queries/members";
import type { MemoryRow } from "#db/queries/memories";
import type { Workspace } from "#db/queries/workspaces";
import type {
  ApiScope,
  apiTokens,
  automationRuns,
  boards,
  comments,
  identities,
} from "#db/schema";
import {
  API_SCOPES,
  AUTOMATION_KINDS,
  CARD_STAGES,
  MEMBER_KINDS,
  MEMORY_KINDS,
  PRIORITIES,
  ATTENTION_STATES,
  ROLES,
  TARGET_KINDS,
  VISIBILITY,
} from "#db/schema";

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const Timestamp = z
  .string()
  .openapi({ format: "date-time", example: "2026-10-26T08:30:00.000Z" });
// The OpenAPI generator publishes a regex with its flags appended (`…$/u`),
// which no client can use, so patterns that reach the spec go without flags.
// oxlint-disable-next-line require-unicode-regexp -- see above
const HH_MM = /^\d{1,2}:\d{2}$/;

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      issues: z.array(z.unknown()).optional(),
    }),
  })
  .openapi("Error");

export const SettingsSchema = z
  .object({
    activeHours: z
      .object({
        start: z.string().regex(HH_MM),
        end: z.string().regex(HH_MM),
      })
      .optional(),
    workdays: z.array(z.number().int().min(0).max(6)).optional(),
    notify: z
      .object({
        dailyPushCap: z.number().int().min(0).max(50).optional(),
        minGapMinutes: z
          .number()
          .int()
          .min(0)
          .max(24 * 60)
          .optional(),
        threadCooldownHours: z
          .number()
          .int()
          .min(0)
          .max(24 * 7)
          .optional(),
      })
      .optional()
      .openapi({
        description:
          "Interruption budget for proactive pings (defaults: 4/day, 90 min apart, 4 h per thread)",
      }),
  })
  .openapi("MemberSettings");

export const MemberSchema = z
  .object({
    id: z.string(),
    kind: z.enum(MEMBER_KINDS),
    role: z.enum(ROLES),
    name: z.string(),
    handle: z.string(),
    email: z.string().nullable(),
    title: z.string().nullable(),
    timezone: z.string().nullable(),
    ownerId: z
      .string()
      .nullable()
      .openapi({ description: "For agents: the human they work for" }),
    agentProvider: z.string().nullable().openapi({
      description:
        '"worklog" for personal assistants; e.g. "claude-code" for external agents',
    }),
    signedUp: z.boolean().openapi({
      description:
        "For humans: whether a signed-in account is attached (false = invited, not yet joined)",
    }),
    settings: SettingsSchema,
    createdAt: Timestamp,
  })
  .openapi("Member");

export const toMember = (m: Member): z.infer<typeof MemberSchema> => ({
  id: m.id,
  kind: m.kind,
  role: m.role,
  name: m.name,
  handle: m.handle,
  email: m.email,
  title: m.title,
  timezone: m.timezone,
  ownerId: m.ownerId,
  agentProvider: m.agentProvider,
  signedUp: m.userId !== null,
  settings: m.settings,
  createdAt: iso(m.createdAt),
});

export const WorkspaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    entropyDays: z.number().int(),
  })
  .openapi("Workspace");

export const toWorkspace = (w: Workspace): z.infer<typeof WorkspaceSchema> => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  timezone: w.timezone,
  entropyDays: w.entropyDays,
});

export const TokenSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    token: z.string().openapi({
      description: "Shown once. Send as `Authorization: Bearer <token>`.",
    }),
    prefix: z.string(),
    scopes: z.array(z.enum(API_SCOPES)),
    expiresAt: Timestamp.nullable(),
  })
  .openapi("ApiKey");

export const toToken = (t: {
  id: string;
  name: string;
  token: string;
  prefix: string;
  scopes: ApiScope[];
  expiresAt: Date | null;
}): z.infer<typeof TokenSchema> => ({
  ...t,
  expiresAt: isoOrNull(t.expiresAt),
});

export const TokenInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    scopes: z.array(z.enum(API_SCOPES)),
    expiresAt: Timestamp.nullable(),
    lastUsedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi("ApiKeyInfo");

export const toTokenInfo = (
  t: typeof apiTokens.$inferSelect
): z.infer<typeof TokenInfoSchema> => ({
  id: t.id,
  name: t.name,
  prefix: t.prefix,
  scopes: t.scopes,
  expiresAt: isoOrNull(t.expiresAt),
  lastUsedAt: isoOrNull(t.lastUsedAt),
  createdAt: iso(t.createdAt),
});

export const IdentitySchema = z
  .object({
    id: z.string(),
    memberId: z.string().nullable().openapi({
      description: "null = seen in events but not matched to anyone yet",
    }),
    provider: z.string().openapi({
      description:
        'Identity namespace, e.g. "github", "slack", "gitea:git.example.com"',
    }),
    externalId: z.string(),
    externalHandle: z.string().nullable(),
    displayName: z.string().nullable(),
    isBot: z.boolean(),
    eventCount: z.number().int(),
    lastSeenAt: Timestamp.nullable(),
  })
  .openapi("Identity");

export const toIdentity = (
  i: typeof identities.$inferSelect
): z.infer<typeof IdentitySchema> => ({
  id: i.id,
  memberId: i.memberId,
  provider: i.provider,
  externalId: i.externalId,
  externalHandle: i.externalHandle,
  displayName: i.displayName,
  isBot: i.isBot,
  eventCount: i.eventCount,
  lastSeenAt: isoOrNull(i.lastSeenAt),
});

export const ColumnSchema = z
  .object({
    id: z.string(),
    boardId: z.string(),
    name: z.string(),
    color: z.string(),
    position: z.number().int(),
  })
  .openapi("Column");

export const toColumn = (c: Column): z.infer<typeof ColumnSchema> => ({
  id: c.id,
  boardId: c.boardId,
  name: c.name,
  color: c.color,
  position: c.position,
});

export const BoardSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    entropyDays: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "null = inherit the workspace setting" }),
    archived: z.boolean(),
    createdAt: Timestamp,
    columns: z.array(ColumnSchema),
  })
  .openapi("Board");

export const toBoard = (
  b: typeof boards.$inferSelect & { columns: Column[] }
): z.infer<typeof BoardSchema> => ({
  id: b.id,
  name: b.name,
  description: b.description,
  entropyDays: b.entropyDays,
  archived: b.archivedAt !== null,
  createdAt: iso(b.createdAt),
  columns: b.columns.map(toColumn),
});

export const CardSchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    boardId: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    stage: z.enum(CARD_STAGES).openapi({
      description:
        "triage = Maybe?, active = in a column, not_now = postponed, done = closed",
    }),
    columnId: z.string().nullable(),
    columnName: z.string().nullable(),
    golden: z.boolean(),
    dueOn: z.string().nullable(),
    assigneeIds: z.array(z.string()),
    tags: z.array(z.string()),
    source: z.string(),
    externalUrl: z.string().nullable(),
    createdById: z.string().nullable(),
    lastActiveAt: Timestamp,
    postponedAt: Timestamp.nullable(),
    autoPostponed: z.boolean(),
    closedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    entropy: z
      .object({
        days: z.number().int(),
        autoPostponeAt: Timestamp,
        postponingSoon: z.boolean(),
      })
      .nullable()
      .openapi({
        description:
          "For active cards: when it drifts to Not now without activity",
      }),
  })
  .openapi("Card");

export const toCard = (c: CardView): z.infer<typeof CardSchema> => ({
  id: c.id,
  number: c.number,
  boardId: c.boardId,
  title: c.title,
  body: c.body,
  stage: c.stage,
  columnId: c.columnId,
  columnName: c.columnName,
  golden: c.golden,
  dueOn: c.dueOn,
  assigneeIds: c.assigneeIds,
  tags: c.tags,
  source: c.source,
  externalUrl: c.externalUrl,
  createdById: c.createdById,
  lastActiveAt: iso(c.lastActiveAt),
  postponedAt: isoOrNull(c.postponedAt),
  autoPostponed: c.autoPostponed,
  closedAt: isoOrNull(c.closedAt),
  createdAt: iso(c.createdAt),
  entropy: c.entropy
    ? { ...c.entropy, autoPostponeAt: iso(c.entropy.autoPostponeAt) }
    : null,
});

export const CommentSchema = z
  .object({
    id: z.string(),
    authorId: z.string().nullable(),
    body: z.string(),
    createdAt: Timestamp,
  })
  .openapi("Comment");

export const toComment = (
  c: typeof comments.$inferSelect
): z.infer<typeof CommentSchema> => ({
  id: c.id,
  authorId: c.authorId,
  body: c.body,
  createdAt: iso(c.createdAt),
});

export const CardDetailSchema = CardSchema.extend({
  comments: z.array(CommentSchema),
  watcherIds: z.array(z.string()),
}).openapi("CardDetail");

export const ActivitySchema = z
  .object({
    id: z.string(),
    actorId: z.string().nullable(),
    source: z.string(),
    kind: z.string().openapi({ example: "pr.merged" }),
    title: z.string(),
    body: z.string().nullable(),
    url: z.string().nullable(),
    cardId: z.string().nullable(),
    visibility: z.enum(VISIBILITY),
    data: z.record(z.string(), z.unknown()),
    connectionId: z.string().nullable(),
    actorIdentityId: z.string().nullable().openapi({
      description:
        "The external account that did it (set even when not matched to a member yet)",
    }),
    onBehalfOfId: z
      .string()
      .nullable()
      .openapi({ description: "For agent work: the person it was done for" }),
    agentState: z
      .enum(["working", "needs_you", "finished", "failed"])
      .nullable(),
    threadKey: z.string().nullable().openapi({
      description: "Related events share a thread, e.g. github:acme/api#7",
    }),
    importance: z.number(),
    count: z.number().int().openapi({
      description:
        "How many events were merged into this one (bursts of commits, comments, replies)",
    }),
    occurredAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Activity");

export const toActivity = (a: ActivityRow): z.infer<typeof ActivitySchema> => ({
  id: a.id,
  actorId: a.actorId,
  source: a.source,
  kind: a.kind,
  title: a.title,
  body: a.body,
  url: a.url,
  cardId: a.cardId,
  visibility: a.visibility,
  data: a.data,
  connectionId: a.connectionId,
  actorIdentityId: a.actorIdentityId,
  onBehalfOfId: a.onBehalfOfId,
  agentState: a.agentState,
  threadKey: a.threadKey,
  importance: a.importance,
  count: a.count,
  occurredAt: iso(a.occurredAt),
  updatedAt: iso(a.updatedAt),
});

export const AttentionSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    url: z.string().nullable(),
    cardId: z.string().nullable(),
    activityId: z.string().nullable(),
    fromId: z.string().nullable(),
    priority: z.enum(PRIORITIES),
    state: z.enum(ATTENTION_STATES),
    count: z.number().int(),
    snoozedUntil: Timestamp.nullable(),
    disposition: z
      .enum(["push", "digest", "drop"])
      .nullable()
      .openapi({ description: "What the proactive check decided" }),
    reason: z
      .string()
      .nullable()
      .openapi({ description: "Why am I seeing this" }),
    pushedAt: Timestamp.nullable(),
    actions: z
      .array(z.object({ id: z.string(), label: z.string() }))
      .nullable()
      .openapi({
        description:
          "One-click answers: POST /v1/attention/{id}/actions/{actionId}",
      }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("AttentionItem");

export const toAttention = (
  a: AttentionItem
): z.infer<typeof AttentionSchema> => ({
  id: a.id,
  kind: a.kind,
  title: a.title,
  body: a.body,
  url: a.url,
  cardId: a.cardId,
  activityId: a.activityId,
  fromId: a.fromId,
  priority: a.priority,
  state: a.state,
  count: a.count,
  snoozedUntil: isoOrNull(a.snoozedUntil),
  disposition: a.disposition,
  reason: a.reason,
  pushedAt: isoOrNull(a.pushedAt),
  actions: a.actions,
  createdAt: iso(a.createdAt),
  updatedAt: iso(a.updatedAt),
});

export const AttentionMetricsSchema = z
  .object({
    days: z.number().int(),
    pushes: z.number().int(),
    itemsPushed: z.number().int(),
    actedOnRate: z.number().nullable(),
    dismissalRate: z.number().nullable(),
    feedback: z.object({
      useful: z.number().int(),
      not_useful: z.number().int(),
      less_like_this: z.number().int(),
    }),
    precision: z
      .number()
      .nullable()
      .openapi({ description: "useful / all rated pushes" }),
    mutedKinds: z.array(z.string()).openapi({
      description: "Kinds now held for digests because of your feedback",
    }),
  })
  .openapi("AttentionMetrics");

export const SnapshotSchema = z
  .object({
    person: z.object({
      id: z.string(),
      name: z.string(),
      handle: z.string(),
      kind: z.enum(MEMBER_KINDS),
      title: z.string().nullable(),
    }),
    inProgress: z.array(
      z.object({
        number: z.number().int(),
        title: z.string(),
        column: z.string().nullable(),
        golden: z.boolean(),
        lastActiveAt: Timestamp,
      })
    ),
    upNext: z.array(z.object({ number: z.number().int(), title: z.string() })),
    recent: z.array(
      z.object({
        at: Timestamp,
        kind: z.string(),
        source: z.string(),
        title: z.string(),
        detail: z.string().nullable(),
        url: z.string().nullable(),
      })
    ),
    lastActiveAt: Timestamp.nullable(),
  })
  .openapi("WorkSnapshot");

export const toSnapshot = (s: WorkSnapshot): z.infer<typeof SnapshotSchema> =>
  s;

export const BriefSchema = z
  .object({
    id: z.string(),
    period: z.enum(["daily", "weekly"]),
    periodStart: Timestamp,
    periodEnd: Timestamp,
    title: z.string(),
    body: z.string().openapi({ description: "Markdown" }),
    data: z.record(z.string(), z.unknown()).openapi({
      description:
        "The structured data the brief was written from, for native rendering",
    }),
    composedBy: z.string(),
    createdAt: Timestamp,
  })
  .openapi("Brief");

export const toBrief = (b: BriefRow): z.infer<typeof BriefSchema> => ({
  id: b.id,
  period: b.period,
  periodStart: iso(b.periodStart),
  periodEnd: iso(b.periodEnd),
  title: b.title,
  body: b.body,
  data: b.data,
  composedBy: b.composedBy,
  createdAt: iso(b.createdAt),
});

export const TargetSchema = z
  .object({
    id: z.string(),
    kind: z.enum(TARGET_KINDS),
    label: z.string(),
    address: z.string(),
    connectionId: z.string().nullable(),
    enabled: z.boolean(),
    createdAt: Timestamp,
  })
  .openapi("DeliveryTarget");

export const toTarget = (t: TargetRow): z.infer<typeof TargetSchema> => ({
  id: t.id,
  kind: t.kind,
  label: t.label,
  address: t.address,
  connectionId: t.connectionId,
  enabled: t.enabled,
  createdAt: iso(t.createdAt),
});

const HHMM = z.string().regex(HH_MM);
export const ScheduleSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("daily"),
      at: HHMM,
      weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    }),
    z.object({
      type: z.literal("weekly"),
      weekday: z.number().int().min(0).max(6),
      at: HHMM,
    }),
    z.object({
      type: z.literal("interval"),
      minutes: z.number().int().min(5),
      activeHoursOnly: z.boolean().optional(),
    }),
  ])
  .openapi("Schedule");

export const AutomationSchema = z
  .object({
    id: z.string(),
    kind: z.enum(AUTOMATION_KINDS),
    name: z.string(),
    schedule: ScheduleSchema,
    targetIds: z.array(z.string()),
    instructions: z.string().nullable(),
    enabled: z.boolean(),
    nextRunAt: Timestamp.nullable(),
    lastRunAt: Timestamp.nullable(),
    lastStatus: z.string().nullable(),
    lastResult: z
      .object({ status: z.string(), summary: z.string(), at: z.string() })
      .nullable(),
    failureCount: z.number().int(),
  })
  .openapi("Automation");

export const toAutomation = (
  a: Automation
): z.infer<typeof AutomationSchema> => ({
  id: a.id,
  kind: a.kind,
  name: a.name,
  schedule: a.schedule,
  targetIds: a.targetIds,
  instructions: a.instructions,
  enabled: a.enabled,
  nextRunAt: isoOrNull(a.nextRunAt),
  lastRunAt: isoOrNull(a.lastRunAt),
  lastStatus: a.lastStatus,
  lastResult: a.state.lastResult ?? null,
  failureCount: a.failureCount,
});

export const AutomationRunSchema = z
  .object({
    id: z.string(),
    status: z.enum(["skipped", "quiet", "delivered", "failed"]),
    summary: z.string().nullable(),
    error: z.string().nullable(),
    startedAt: Timestamp,
    finishedAt: Timestamp,
  })
  .openapi("AutomationRun");

export const toRun = (
  r: typeof automationRuns.$inferSelect
): z.infer<typeof AutomationRunSchema> => ({
  id: r.id,
  status: r.status,
  summary: r.summary,
  error: r.error,
  startedAt: iso(r.startedAt),
  finishedAt: iso(r.finishedAt),
});

export const MemorySchema = z
  .object({
    id: z.string(),
    kind: z.enum(MEMORY_KINDS),
    content: z.string(),
    visibility: z.enum(VISIBILITY),
    day: z.string().nullable(),
    source: z.enum(["self", "agent", "teammate"]),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Memory");

export const toMemory = (m: MemoryRow): z.infer<typeof MemorySchema> => ({
  id: m.id,
  kind: m.kind,
  content: m.content,
  visibility: m.visibility,
  day: m.day,
  source: m.source,
  createdAt: iso(m.createdAt),
  updatedAt: iso(m.updatedAt),
});

export const ConversationSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    askerId: z.string(),
    mode: z.enum(["owner", "teammate"]),
    inbox: z.boolean(),
    title: z.string().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Conversation");

export const toConversation = (
  c: ConversationRow
): z.infer<typeof ConversationSchema> => ({
  id: c.id,
  agentId: c.agentId,
  askerId: c.askerId,
  mode: c.mode,
  inbox: c.inbox,
  title: c.title,
  createdAt: iso(c.createdAt),
  updatedAt: iso(c.updatedAt),
});

export const MessageSchema = z
  .object({
    id: z.string(),
    seq: z.number().int(),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    createdAt: Timestamp,
  })
  .openapi("Message");

/** Tool calls and results stay server-side; clients see the readable turns. */
export const toMessages = (
  rows: MessageRow[]
): z.infer<typeof MessageSchema>[] =>
  rows
    .filter(
      (r): r is MessageRow & { role: "user" | "assistant"; text: string } =>
        r.role !== "tool" && !!r.text
    )
    .map((r) => ({
      id: r.id,
      seq: r.seq,
      role: r.role,
      text: r.text,
      createdAt: iso(r.createdAt),
    }));

export const ConnectionSchema = z
  .object({
    id: z.string(),
    provider: z.string().openapi({ example: "github" }),
    name: z.string(),
    status: z.enum(["active", "paused"]),
    settings: z.record(z.string(), z.unknown()),
    lastEventAt: Timestamp.nullable(),
    createdAt: Timestamp,
    webhookUrls: z
      .record(z.string(), z.string())
      .openapi({ description: "Paste these into the provider's app settings" }),
  })
  .openapi("Connection");

export const toConnection = (
  c: ConnectionRow,
  webhookUrls: Record<string, string>
): z.infer<typeof ConnectionSchema> => ({
  id: c.id,
  provider: c.provider,
  name: c.name,
  status: c.status,
  settings: c.settings,
  lastEventAt: isoOrNull(c.lastEventAt),
  createdAt: iso(c.createdAt),
  webhookUrls,
});
