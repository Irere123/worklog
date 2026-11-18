import { setTimeout as sleep } from "node:timers/promises";

import type { AppContext } from "#context";
import { findActivityById, listThreadActivities } from "#db/queries/activities";
import {
  findAgentClient,
  findAgentConnection,
  insertAgentConnection,
  listAgentConnections,
  revokeAgentGrant,
  setAgentActive,
  touchAgentConnection,
} from "#db/queries/agent-connections";
import type {
  AgentClient,
  AgentConnection,
} from "#db/queries/agent-connections";
import {
  findAttentionByDedupeKey,
  getAttentionById,
  listUnsettledFrom,
} from "#db/queries/attention";
import type { AttentionItem } from "#db/queries/attention";
import { listComments } from "#db/queries/cards";
import type { StoredEvent } from "#db/queries/events";
import {
  findMemberById,
  listMembersByIds,
  listMemberships,
  WORKLOG_AGENT,
} from "#db/queries/members";
import type { Member } from "#db/queries/members";
import type { ApiScope } from "#db/schema";
import { transact } from "#db/transact";
import { AGENT_SCOPES } from "#lib/auth";
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "#lib/errors";
import { generateId } from "#lib/ids";
import { log } from "#telemetry/log";

import { recordActivity } from "./activity";
import {
  AGENT_QUESTION,
  AGENT_QUESTIONS_WAITING,
  updateAttention,
} from "./attention";
import { canActFor, createMember } from "./members";
import type { SignedInUser } from "./members";

const TOOLS = [
  {
    provider: "claude-code",
    name: /claude[\s_-]*code/iu,
    hosts: ["claude.ai", "claude.com", "anthropic.com"],
  },
  {
    provider: "claude",
    name: /claude/iu,
    hosts: ["claude.ai", "claude.com", "anthropic.com"],
  },
  { provider: "cursor", name: /cursor/iu, hosts: ["cursor.com", "cursor.sh"] },
  {
    provider: "copilot",
    name: /copilot|visual studio code|vs ?code/iu,
    hosts: ["github.com", "githubcopilot.com", "visualstudio.com"],
  },
  { provider: "codex", name: /codex/iu, hosts: ["openai.com", "chatgpt.com"] },
  {
    provider: "windsurf",
    name: /windsurf|codeium/iu,
    hosts: ["windsurf.com", "codeium.com"],
  },
  { provider: "gemini", name: /gemini/iu, hosts: ["google.com"] },
] as const;

/** The domain vouching for a client: its metadata document's host, when it has one. */
export function verifiedHost(
  client: Pick<AgentClient, "clientId" | "verified">
) {
  if (!client.verified) {
    return null;
  }
  try {
    return new URL(client.clientId).hostname;
  } catch {
    return null;
  }
}

/** The agent's `agentProvider`: a known tool's id, else the client's own name as a slug. */
export function providerOf(client: AgentClient) {
  const name = client.name ?? "";
  const host = verifiedHost(client);
  const ofHost = host
    ? TOOLS.filter((t) =>
        t.hosts.some((h) => host === h || host.endsWith(`.${h}`))
      )
    : TOOLS;
  const tool =
    ofHost.find((t) => t.name.test(name)) ?? (host ? ofHost[0] : undefined);
  if (tool) {
    return tool.provider;
  }
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 40);
  return slug === "" ? "custom" : slug;
}

function displayName(client: AgentClient) {
  const name = client.name?.trim().slice(0, 60) ?? "";
  return name === "" ? "Coding agent" : name;
}

/**
 * The workspace an approval is for, read while the OAuth server decides whether consent exists:
 * the one picked on the approval page if they still belong to it, else their only one.
 */
export async function agentWorkspace(
  ctx: AppContext,
  userId: string,
  picked: string | undefined
) {
  const memberships = await listMemberships(ctx.db, { userId });
  const humans = memberships.filter((m) => m.member.kind === "human");
  if (picked !== undefined) {
    return humans.find((m) => m.workspace.id === picked)?.workspace.id;
  }
  const [only] = humans;
  return humans.length === 1 ? only?.workspace.id : undefined;
}

/** What the approval page shows: who is asking, and where it could work for this person. */
export async function agentApproval(
  ctx: AppContext,
  user: SignedInUser,
  clientId: string
) {
  const client = await findAgentClient(ctx.db, { clientId });
  if (!client) {
    throw notFound("That app");
  }
  const memberships = await listMemberships(ctx.db, { userId: user.id });
  const workspaces = [];
  for (const { member, workspace } of memberships) {
    if (member.kind !== "human") {
      continue;
    }
    const existing = await findAgentConnection(ctx.db, {
      workspaceId: workspace.id,
      ownerId: member.id,
      clientId,
    });
    workspaces.push({
      id: workspace.id,
      name: workspace.name,
      agent:
        existing && existing.agent.deactivatedAt === null
          ? existing.agent
          : null,
    });
  }
  return {
    signedInAs: user.email,
    client: {
      id: client.clientId,
      name: displayName(client),
      uri: client.uri,
      verifiedHost: verifiedHost(client),
      provider: providerOf(client),
    },
    workspaces,
  };
}

export type AgentGrant = {
  agent: Member;
  owner: Member;
  workspaceName: string;
  scopes: ApiScope[];
};

const TOUCH_EVERY_MS = 5 * 60 * 1000;

/** Claims Worklog reads from a verified MCP access token. */
export type AgentClaims = {
  sub?: unknown;
  azp?: unknown;
  client_id?: unknown;
  scope?: unknown;
  iat?: unknown;
  worklog_workspace?: unknown;
};

const reconnect = (message: string) =>
  new ApiError(401, "invalid_token", message);

/**
 * The agent a verified access token speaks for, made on its first call: a member of the workspace
 * the person approved it into, working for them, labelled with its tool. A second install of the
 * same tool (another laptop registers a new client) joins the agent it already has.
 */
export async function agentForToken(
  ctx: AppContext,
  claims: AgentClaims
): Promise<AgentGrant> {
  const userId = text(claims.sub);
  const clientId = text(claims.azp) ?? text(claims.client_id);
  const workspaceId = text(claims.worklog_workspace);
  if (!userId || !clientId || !workspaceId) {
    throw reconnect("This token wasn't approved for a workspace");
  }
  const memberships = await listMemberships(ctx.db, { userId });
  const membership = memberships.find(
    (m) => m.workspace.id === workspaceId && m.member.kind === "human"
  );
  if (!membership) {
    throw forbidden("You're no longer a member of that workspace");
  }
  const owner = membership.member;
  const base = {
    owner,
    workspaceName: membership.workspace.name,
    scopes: grantedScopes(claims.scope),
  };
  const found = await findAgentConnection(ctx.db, {
    workspaceId,
    ownerId: owner.id,
    clientId,
  });
  if (found) {
    const agent = await revived(ctx, found.agent, claims.iat);
    touch(ctx, found.connection);
    return { ...base, agent };
  }
  const client = await findAgentClient(ctx.db, { clientId });
  if (!client) {
    throw reconnect("This app is no longer registered");
  }
  const agent = await connect(ctx, owner, client);
  if (agent) {
    return { ...base, agent };
  }
  const winner = await findAgentConnection(ctx.db, {
    workspaceId,
    ownerId: owner.id,
    clientId,
  });
  if (!winner) {
    throw new ApiError(409, "conflict", "Still connecting; try again");
  }
  return { ...base, agent: winner.agent };
}

function touch(ctx: AppContext, connection: AgentConnection) {
  const now = ctx.now();
  if (
    connection.lastUsedAt &&
    now.getTime() - connection.lastUsedAt.getTime() < TOUCH_EVERY_MS
  ) {
    return;
  }
  void recordAgentUse(ctx, connection.id, now);
}

function text(claim: unknown) {
  return typeof claim === "string" ? claim : undefined;
}

function grantedScopes(scope: unknown): ApiScope[] {
  const granted = new Set(typeof scope === "string" ? scope.split(" ") : []);
  return AGENT_SCOPES.filter((s) => granted.has(s));
}

async function revived(ctx: AppContext, agent: Member, iat: unknown) {
  if (agent.deactivatedAt === null) {
    return agent;
  }
  const issuedAt = typeof iat === "number" ? iat * 1000 : 0;
  if (issuedAt <= agent.deactivatedAt.getTime()) {
    throw reconnect(
      "This agent was disconnected. Connect it again to continue"
    );
  }
  await setAgentActive(ctx.db, { agentId: agent.id, deactivatedAt: null });
  return { ...agent, deactivatedAt: null };
}

class RacedError extends Error {
  override name = "RacedError";
}

async function connect(ctx: AppContext, owner: Member, client: AgentClient) {
  const provider = providerOf(client);
  const name = displayName(client);
  try {
    return await makeAgent(ctx, owner, client, { provider, name });
  } catch (error) {
    if (error instanceof RacedError) {
      return null;
    }
    throw error;
  }
}

async function makeAgent(
  ctx: AppContext,
  owner: Member,
  client: AgentClient,
  { provider, name }: { provider: string; name: string }
) {
  return await transact(ctx, async (tx) => {
    const siblings = await listAgentConnections(tx.db, {
      workspaceId: owner.workspaceId,
      ownerId: owner.id,
    });
    const sibling = siblings.find(
      (s) => s.agent.agentProvider === provider && s.agent.name === name
    )?.agent;
    const agent =
      sibling ??
      (await createMember(tx, owner.workspaceId, {
        kind: "agent",
        name,
        handle: `${owner.handle} ${name}`,
        ownerId: owner.id,
        agentProvider: provider,
        title: "Coding agent",
      }));
    const inserted = await insertAgentConnection(tx.db, {
      id: generateId(),
      workspaceId: owner.workspaceId,
      agentId: agent.id,
      ownerId: owner.id,
      clientId: client.clientId,
      lastUsedAt: tx.now(),
      createdAt: tx.now(),
    });
    if (!inserted) {
      throw new RacedError();
    }
    return agent;
  });
}

export async function listConnectedAgents(ctx: AppContext, viewer: Member) {
  const admin = viewer.role === "owner" || viewer.role === "admin";
  const rows = await listAgentConnections(ctx.db, {
    workspaceId: viewer.workspaceId,
    ownerId: admin ? undefined : viewer.id,
  });
  return rows.map((r) => ({
    id: r.connection.id,
    agent: r.agent,
    ownerId: r.connection.ownerId,
    clientName: r.client?.name ?? null,
    verifiedHost: verifiedHost({
      clientId: r.connection.clientId,
      verified: (r.client?.discovery ?? null) !== null,
    }),
    lastUsedAt: r.connection.lastUsedAt,
    createdAt: r.connection.createdAt,
  }));
}

/**
 * Ends an agent's access: it leaves the team (its history stays), and every approval it holds is
 * revoked, so connecting it again sends its person back through the approval page.
 */
export async function disconnectAgent(
  ctx: AppContext,
  viewer: Member,
  agent: Member
) {
  if (agent.kind !== "agent" || agent.agentProvider === WORKLOG_AGENT) {
    throw badRequest("Only a connected coding agent can be disconnected");
  }
  if (!canActFor(viewer, agent)) {
    throw forbidden("Only its person or an admin can disconnect it");
  }
  const all = await listAgentConnections(ctx.db, {
    workspaceId: agent.workspaceId,
  });
  const connections = all.filter((c) => c.agent.id === agent.id);
  if (!connections.length) {
    throw badRequest(
      "This agent didn't connect itself; revoke its API keys instead"
    );
  }
  const owner = agent.ownerId
    ? await findMemberById(ctx.db, { id: agent.ownerId })
    : undefined;
  await transact(ctx, async (tx) => {
    const now = tx.now();
    await setAgentActive(tx.db, { agentId: agent.id, deactivatedAt: now });
    for (const { connection } of connections) {
      if (owner?.userId) {
        await revokeAgentGrant(tx.db, {
          clientId: connection.clientId,
          userId: owner.userId,
          workspaceId: agent.workspaceId,
          now,
        });
      }
    }
  });
}

const ANSWER = "question.answered";
const THREAD_PREFIX = "agent:";
const REPORTS = [
  "agent.working",
  AGENT_QUESTION,
  "agent.finished",
  "agent.failed",
];

/**
 * Whether a report adds nothing to its thread's latest one: a client retrying a call that went
 * through, or a model saying it again. Writing it would put the same question to its person twice.
 */
export async function repeatsLastReport(
  ctx: AppContext,
  agent: Member,
  report: {
    thread: string;
    state: string;
    title: string;
    details?: string;
    url?: string;
  }
) {
  const [last] = await listThreadActivities(ctx.db, {
    workspaceId: agent.workspaceId,
    threadKey: report.thread,
    actorIds: [agent.id],
    kinds: REPORTS,
    limit: 1,
  });
  return (
    last !== undefined &&
    last.agentState === report.state &&
    last.title === report.title &&
    last.body === (report.details ?? null) &&
    last.url === (report.url ?? null)
  );
}

/**
 * Refuses a new question while its person already has the most an agent may keep waiting on them:
 * past that it would wait for their digest, and the agent should hear so now, not after an hour of
 * check_ins.
 */
export async function assertRoomToAsk(
  ctx: AppContext,
  { agent, owner }: AgentGrant,
  thread: string
) {
  const waiting = await listUnsettledFrom(ctx.db, {
    memberId: owner.id,
    fromId: agent.id,
    kind: AGENT_QUESTION,
    exceptDedupeKey: `${THREAD_PREFIX}${thread}`,
  });
  if (waiting.length >= AGENT_QUESTIONS_WAITING) {
    const threads = waiting.map((w) => w.dedupeKey.slice(THREAD_PREFIX.length));
    throw conflict(
      `${owner.name} hasn't answered ${waiting.length} of your questions yet (threads ${threads.join(", ")}). check_in on those, or carry on without asking.`
    );
  }
}

type Answer = Awaited<ReturnType<typeof answersFor>>;
type Asked = { item: AttentionItem; replies: Answer["replies"] };

/**
 * The agent's latest question on a thread and what its person said to it. With `waitMs`, an
 * unanswered question is held until they act on it or write back, so an agent with nothing else to
 * do makes one call instead of polling, each poll a model turn it pays for.
 */
export async function checkIn(
  ctx: AppContext,
  grant: AgentGrant,
  thread: string,
  opts: { waitMs?: number; signal?: AbortSignal } = {}
): Promise<Asked | null> {
  const read = async () => {
    const item = await findAttentionByDedupeKey(ctx.db, {
      memberId: grant.owner.id,
      dedupeKey: `${THREAD_PREFIX}${thread}`,
    });
    if (!item) {
      return null;
    }
    const { replies } = await answersFor(ctx, grant, item);
    return { item, replies };
  };
  const waitMs = opts.waitMs ?? 0;
  if (waitMs <= 0) {
    return await read();
  }
  const watch = watchQuestions(ctx, grant);
  try {
    const deadline = ctx.now().getTime() + waitMs;
    let asked = await read();
    while (asked && unanswered(asked) && opts.signal?.aborted !== true) {
      watch.focus(asked.item);
      const left = deadline - ctx.now().getTime();
      if (left <= 0) {
        break;
      }
      await watch.next(left, opts.signal);
      asked = await read();
    }
    return asked;
  } finally {
    watch.stop();
  }
}

function unanswered({ item, replies }: Asked) {
  return (
    (item.state === "open" || item.state === "snoozed") && replies.length === 0
  );
}

function watchQuestions(ctx: AppContext, { agent, owner }: AgentGrant) {
  let target: AttentionItem | undefined;
  let pending = false;
  let wake: (() => void) | undefined;
  const concerns = (event: StoredEvent) => {
    if (event.workspaceId !== owner.workspaceId) {
      return false;
    }
    const { data } = event;
    if (event.type === "attention.updated") {
      return target
        ? data.id === target.id
        : event.audienceId === owner.id && data.kind === AGENT_QUESTION;
    }
    return (
      event.type === "activity.created" &&
      data.kind === "comment.created" &&
      data.actorId !== agent.id &&
      (target === undefined || data.cardId === target.cardId)
    );
  };
  const stop = ctx.bus.subscribe((event) => {
    if (concerns(event)) {
      pending = true;
      wake?.();
    }
  });
  return {
    stop,
    focus: (item: AttentionItem) => {
      target = item;
    },
    next: async (ms: number, signal?: AbortSignal) => {
      if (pending) {
        pending = false;
        return;
      }
      const woken = new AbortController();
      wake = () => {
        woken.abort();
      };
      try {
        await sleep(ms, undefined, {
          signal: AbortSignal.any(
            signal ? [woken.signal, signal] : [woken.signal]
          ),
        });
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          throw error;
        }
      } finally {
        wake = undefined;
        pending = false;
      }
    },
  };
}

/**
 * A person's written answer to their agent's question, which the agent reads with check_in. It is
 * private to them: agents ask for credentials and decisions not yet made, and a teammate's feed
 * is no place for either. Answering settles the question.
 */
export async function answerAgent(
  ctx: AppContext,
  me: Member,
  itemId: string,
  body: string
) {
  const item = await getAttentionById(ctx.db, { id: itemId, memberId: me.id });
  const agent =
    item.kind === AGENT_QUESTION && item.fromId
      ? await findMemberById(ctx.db, {
          id: item.fromId,
          workspaceId: me.workspaceId,
        })
      : undefined;
  if (!agent || !item.dedupeKey.startsWith(THREAD_PREFIX)) {
    throw badRequest("Only an agent's question takes a written answer");
  }
  const question = item.activityId
    ? await findActivityById(ctx.db, { id: item.activityId })
    : undefined;
  await recordActivity(ctx, {
    workspaceId: me.workspaceId,
    actorId: me.id,
    source: "worklog",
    kind: ANSWER,
    title: `Answered ${agent.name}: ${question?.title ?? item.title}`,
    body,
    cardId: item.cardId,
    visibility: "private",
    threadKey: item.dedupeKey.slice(THREAD_PREFIX.length),
    data: { agentId: agent.id, attentionId: item.id },
  });
  return await updateAttention(ctx, me.id, item.id, { state: "done" });
}

/**
 * What the agent's person said to its latest question on a thread: answers from the inbox, and
 * comments on the question's card by anyone but the agent. An answer to an earlier question on the
 * same thread is history, not news.
 */
export async function answersFor(
  ctx: AppContext,
  grant: AgentGrant,
  item: AttentionItem
) {
  const { agent, owner } = grant;
  const said = await listThreadActivities(ctx.db, {
    workspaceId: agent.workspaceId,
    threadKey: item.dedupeKey.slice(THREAD_PREFIX.length),
    actorIds: [agent.id, owner.id],
    kinds: [AGENT_QUESTION, ANSWER],
  });
  const askedAt =
    said.findLast((a) => a.kind === AGENT_QUESTION && a.actorId === agent.id)
      ?.occurredAt ?? item.createdAt;
  const inInbox = said
    .filter(
      (a) =>
        a.kind === ANSWER && a.actorId === owner.id && a.occurredAt >= askedAt
    )
    .map((a) => ({
      from: `@${owner.handle}`,
      at: a.occurredAt,
      body: a.body ?? "",
      on: "inbox" as const,
    }));
  const onCard = item.cardId
    ? await cardReplies(ctx, item.cardId, askedAt, agent.id)
    : [];
  const replies = [...inInbox, ...onCard].toSorted(
    (a, b) => a.at.getTime() - b.at.getTime()
  );
  return { askedAt, replies };
}

async function cardReplies(
  ctx: AppContext,
  cardId: string,
  since: Date,
  agentId: string
) {
  const said = await listComments(ctx.db, { cardId, since });
  const comments = said.filter((c) => c.authorId !== agentId);
  const ids = [
    ...new Set(comments.flatMap((c) => (c.authorId ? [c.authorId] : []))),
  ];
  const authors = await listMembersByIds(ctx.db, { ids });
  return comments.map((c) => {
    const author = authors.find((p) => p.id === c.authorId);
    return {
      from: author ? `@${author.handle}` : null,
      at: c.createdAt,
      body: c.body,
      on: "card" as const,
    };
  });
}

async function recordAgentUse(ctx: AppContext, id: string, now: Date) {
  try {
    await touchAgentConnection(ctx.db, { id, now });
  } catch (error) {
    log.warn("agents: couldn't record last use", { error });
  }
}
