import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { runAction } from "#agent/actions";
import type { ActionName } from "#agent/actions";
import type { AppContext } from "#context";
import { listComments } from "#db/queries/cards";
import { listMembersByIds } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import type { ApiScope } from "#db/schema";
import { CARD_STAGES } from "#db/schema";
import { ApiError, badRequest, tooMany } from "#lib/errors";
import { generateId } from "#lib/ids";
import { log } from "#telemetry/log";
import { assertRoomToAsk, checkIn, repeatsLastReport } from "#work/agents";
import type { AgentGrant } from "#work/agents";
import { getCard, listCards } from "#work/board";
import { resolveMember } from "#work/members";
import { reportWork } from "#work/report";

// Agents call these all day, and every reply lands in their context: search and card reads stop
// at a size a model can use, and the rest says where to look.
const CARDS_SHOWN = 20;
const COMMENTS_SHOWN = 20;
// A held check_in answers before MCP clients' one-minute request timeout, and proxies' idle ones.
const WAIT_MAX_S = 50;

// A looping agent shouldn't fill its team's feed. A model takes seconds a turn, so a working agent,
// subagents and all, stays well inside this; a loop runs out within a minute.
const WRITE_BURST = 60;
const WRITE_REFILL_MS = 2000;

// What check_in calls an inbox item's state, from the agent's side of the question.
const STATUS = {
  open: "waiting",
  snoozed: "snoozed",
  done: "resolved",
  dismissed: "dismissed",
} as const;

/**
 * The Worklog a coding agent sees over MCP, built per request for the agent the token speaks for.
 * Tools its approval didn't grant aren't listed at all, so a model never plans around a tool that
 * will refuse it.
 */
export function agentServer(ctx: AppContext, grant: AgentGrant) {
  const can = (scope: ApiScope) => grant.scopes.includes(scope);
  const server = new McpServer(
    {
      name: "worklog",
      title: "Worklog",
      version: ctx.config.WORKLOG_RELEASE,
    },
    {
      instructions: instructions(grant, {
        read: can("read"),
        write: can("write"),
      }),
    }
  );
  if (can("ingest") || can("write")) {
    reportTools(server, ctx, grant);
  }
  if (can("read")) {
    readTools(server, ctx, grant);
  }
  if (can("write")) {
    writeTools(server, ctx, grant);
  }
  return server;
}

function instructions(
  { agent, owner, workspaceName }: AgentGrant,
  can: { read: boolean; write: boolean }
) {
  const first = firstName(owner);
  // Agents treat a request as the whole job and drop anything optional-sounding, so this is
  // framed as part of every task: in testing, "when worth it" meant never.
  return [
    `You're ${agent.name}, the coding agent of ${owner.name} (@${owner.handle}) in ${workspaceName} on Worklog, where the team sees what everyone, people and agents, is working on. Keeping it current is part of every task you're given here, even when the request doesn't mention it:`,
    ...(can.read
      ? [
          `- Before starting, search_cards for the task (assignee "mine" for ${first}'s) and read its card with get_card: what's wanted, what was decided, who else is on it.`,
        ]
      : []),
    "- report_progress working as you start, with the card number if it has one.",
    `- needs_you when the card or request leaves a decision to ${first} (a choice, approval, credentials, a review): ask rather than choose, as they may not be watching this session. It's the only state that reaches them right away. Put the question and options in details, carry on with what you can, then check_in on the thread, with wait once nothing else is left.`,
    "- finished when done: what changed, with a link (pull request, branch, deploy) if there is one. failed if something stopped you.",
    "Pass the thread your first report returns on every later report and check_in for that task. Skip all this for questions you answer without changing anything.",
    ...(can.write
      ? [
          "Create a card only for work not on the board yet; move one only when the work is really in that state.",
        ]
      : []),
  ].join("\n");
}

function firstName(member: Member) {
  return member.name.split(" ")[0] ?? member.name;
}

function reportTools(server: McpServer, ctx: AppContext, grant: AgentGrant) {
  const { agent, owner } = grant;
  server.registerTool(
    "report_progress",
    {
      title: "Report progress",
      description: `Tell ${owner.name}'s team where your task stands. Only "needs_you" notifies ${firstName(owner)} right away; "failed" soon after, "finished" in their next digest, and "working" only shows on the board.`,
      inputSchema: z.object({
        state: z.enum(["working", "needs_you", "finished", "failed"]),
        title: z
          .string()
          .min(1)
          .max(300)
          .describe(
            'One line a teammate understands, e.g. "Adding retries to the referrals sync"'
          ),
        details: z
          .string()
          .max(4000)
          .optional()
          .describe(
            "Markdown: the question and options for needs_you, what changed for finished, the error for failed"
          ),
        url: z
          .url()
          .optional()
          .describe("A pull request, branch, run or preview to look at"),
        card: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The board card this work is for"),
        thread: z
          .string()
          .max(200)
          .optional()
          .describe("The thread an earlier report returned, for the same task"),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (input) =>
      await reply(async () => {
        const known =
          input.thread ??
          (input.card === undefined
            ? undefined
            : `mcp:${agent.id}:card-${input.card}`);
        const thread = known ?? `mcp:${generateId()}`;
        const repeated =
          known !== undefined &&
          (await repeatsLastReport(ctx, agent, { ...input, thread }));
        if (!repeated) {
          if (input.state === "needs_you") {
            await assertRoomToAsk(ctx, grant, thread);
          }
          spendWrite(ctx, agent);
          await reportWork(ctx, agent, {
            source: "mcp",
            kind: `agent.${input.state}`,
            title: input.title,
            body: input.details,
            url: input.url,
            cardNumber: input.card,
            thread,
            state: input.state,
          });
        }
        return input.state === "needs_you"
          ? {
              thread,
              next: `${firstName(owner)} was asked. Carry on with what doesn't depend on it, then check_in with this thread and wait: ${WAIT_MAX_S} to hear back.`,
            }
          : { thread };
      })
  );

  server.registerTool(
    "check_in",
    {
      title: "Check for an answer",
      description: `Whether ${owner.name} answered your latest "needs_you" on a thread, and what they wrote back, in their inbox or on its card.`,
      inputSchema: z.object({
        thread: z.string().describe("The thread report_progress returned"),
        wait: z
          .number()
          .int()
          .min(0)
          .max(WAIT_MAX_S)
          .optional()
          .describe(
            `Seconds to hold for an answer, up to ${WAIT_MAX_S}, instead of calling again. Use it when nothing else is left to do.`
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ thread, wait }, extra) =>
      await reply(async () => {
        const asked = await checkIn(ctx, grant, thread, {
          waitMs: (wait ?? 0) * 1000,
          signal: extra.mcpReq.signal,
        });
        if (!asked) {
          return {
            status: "not_asked",
            note: 'Nothing on this thread is waiting. Ask with report_progress state "needs_you".',
          };
        }
        const status = STATUS[asked.item.state];
        return {
          status,
          resolvedAt: asked.item.resolvedAt,
          replies: asked.replies,
          // Models given an unanswered question tend to end their turn; this says how to stay.
          next:
            status === "waiting" &&
            (wait ?? 0) === 0 &&
            asked.replies.length === 0
              ? `Not answered yet. check_in with wait: ${WAIT_MAX_S} to hold for it.`
              : null,
        };
      })
  );
}

function readTools(server: McpServer, ctx: AppContext, grant: AgentGrant) {
  const { agent, owner } = grant;
  server.registerTool(
    "search_cards",
    {
      title: "Search the board",
      description: `Find cards on the team's board by words in their title or description, stage or assignee; the ${CARDS_SHOWN} most recently active.`,
      inputSchema: z.object({
        query: z.string().optional(),
        stage: z
          .enum(CARD_STAGES)
          .optional()
          .describe(
            "triage: not started (Maybe?), active: in a column, not_now: set aside, done"
          ),
        assignee: z
          .string()
          .optional()
          .describe(`A teammate's handle, or "mine" for ${owner.name}'s cards`),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, stage, assignee }) =>
      await reply(async () => {
        const assigneeId =
          assignee === undefined
            ? undefined
            : await assigneeOf(ctx, grant, assignee);
        const rows = await listCards(ctx, agent.workspaceId, {
          q: query,
          stage,
          assigneeId,
          limit: CARDS_SHOWN + 1,
        });
        if (!rows.length) {
          return "No card matches. Try fewer words, or leave out stage and assignee.";
        }
        const shown = rows.slice(0, CARDS_SHOWN);
        const handles = await handlesOf(
          ctx,
          shown.flatMap((c) => c.assigneeIds)
        );
        return {
          cards: shown.map((c) => ({
            card: c.number,
            title: c.title,
            stage: c.stage,
            column: c.columnName,
            assignees: handlesIn(handles, c.assigneeIds),
            tags: c.tags,
            lastActiveAt: c.lastActiveAt,
          })),
          more:
            rows.length > CARDS_SHOWN
              ? "More match: narrow the query, stage or assignee"
              : null,
        };
      })
  );

  server.registerTool(
    "get_card",
    {
      title: "Read a card",
      description: `A card in full: what's wanted, where it stands, who is on it, and its latest ${COMMENTS_SHOWN} comments.`,
      inputSchema: z.object({ card: z.number().int().positive() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ card }) =>
      await reply(async () => {
        const c = await getCard(ctx, agent.workspaceId, card);
        const latest = await listComments(ctx.db, {
          cardId: c.id,
          latest: COMMENTS_SHOWN + 1,
        });
        const comments = latest.slice(-COMMENTS_SHOWN);
        const handles = await handlesOf(ctx, [
          ...c.assigneeIds,
          ...comments.map((m) => m.authorId),
        ]);
        return {
          card: c.number,
          title: c.title,
          body: c.body,
          stage: c.stage,
          column: c.columnName,
          assignees: handlesIn(handles, c.assigneeIds),
          tags: c.tags,
          dueOn: c.dueOn,
          earlierComments: latest.length > COMMENTS_SHOWN ? true : null,
          comments: comments.map((m) => ({
            from: m.authorId ? handles.get(m.authorId) : null,
            at: m.createdAt,
            body: m.body,
          })),
        };
      })
  );
}

function writeTools(server: McpServer, ctx: AppContext, grant: AgentGrant) {
  const { owner } = grant;
  const act = async (name: ActionName, input: unknown) =>
    await reply(async () => {
      spendWrite(ctx, grant.agent);
      return outcome(await runAction(ctx, grant.agent, owner, name, input));
    });

  server.registerTool(
    "create_card",
    {
      title: "Create a card",
      description:
        "Put work on the board that isn't there yet. Without a column it lands in Maybe? for the team to triage.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        body: z.string().max(4000).optional().describe("Markdown"),
        board: z
          .string()
          .optional()
          .describe("Board name; the first if left out"),
        column: z
          .string()
          .optional()
          .describe("Column name, to start it there"),
        assignToOwner: z
          .boolean()
          .optional()
          .describe(`Assign it to ${owner.name}`),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (input) => await act("create_card", input)
  );

  server.registerTool(
    "move_card",
    {
      title: "Move a card",
      description:
        'Move a card to a column by name, or to "maybe", "not_now" or "done".',
      inputSchema: z.object({
        number: z.number().int().positive().describe("The card number"),
        to: z.string(),
      }),
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => await act("move_card", input)
  );

  server.registerTool(
    "comment_on_card",
    {
      title: "Comment on a card",
      description:
        "Add to a card's discussion. Mention a teammate with @handle to bring them in.",
      inputSchema: z.object({
        number: z.number().int().positive().describe("The card number"),
        body: z.string().min(1).max(4000).describe("Markdown"),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (input) => await act("comment_on_card", input)
  );
}

// Per process: a limit to stop runaways, not a quota to account for, so replicas each keeping
// their own is fine.
const writeBuckets = new Map<string, { left: number; at: number }>();

function spendWrite(ctx: AppContext, agent: Member) {
  const now = ctx.now().getTime();
  const bucket = writeBuckets.get(agent.id);
  const left = bucket
    ? Math.min(WRITE_BURST, bucket.left + (now - bucket.at) / WRITE_REFILL_MS)
    : WRITE_BURST;
  if (left < 1) {
    const seconds = Math.ceil(((1 - left) * WRITE_REFILL_MS) / 1000);
    throw tooMany(
      `Too many changes in a short time. Try again in ${seconds}s, and report less often.`
    );
  }
  writeBuckets.set(agent.id, { left: left - 1, at: now });
}

async function assigneeOf(
  ctx: AppContext,
  { agent, owner }: AgentGrant,
  ref: string
) {
  if (ref === "mine") {
    return owner.id;
  }
  const member = await resolveMember(ctx, agent, ref);
  return member.id;
}

/** Handles by member id, as `@handle`, in one query. */
async function handlesOf(ctx: AppContext, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id) => id !== null))];
  const people = unique.length
    ? await listMembersByIds(ctx.db, { ids: unique })
    : [];
  return new Map(people.map((p) => [p.id, `@${p.handle}`]));
}

function handlesIn(handles: Map<string, string>, ids: string[]) {
  return ids.flatMap((id) => handles.get(id) ?? []);
}

// A shared action answers in the assistant's shape; the agent needs only what changed, and a
// refusal it returns rather than throws is still a refusal.
function outcome(result: unknown) {
  if (typeof result !== "object" || result === null) {
    return result;
  }
  const rest = Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "ok" && key !== "id")
  );
  if (typeof rest.error === "string") {
    throw badRequest(rest.error);
  }
  return Object.keys(rest).length ? rest : "Done.";
}

/** A tool's result as text the model reads, and a refusal as an error it can recover from. */
async function reply(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await run();
    return {
      content: [
        {
          type: "text",
          text: typeof value === "string" ? value : JSON.stringify(value, lean),
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message }],
      };
    }
    log.error("mcp: tool failed", { error });
    return {
      isError: true,
      content: [{ type: "text", text: "Something went wrong in Worklog." }],
    };
  }
}

const ISO = /^(?<minute>\d{4}-\d\d-\d\dT\d\d:\d\d):\d\d(?:\.\d+)?Z$/u;

// Every reply is read by a model, which pays for each character: no indentation, nothing for
// empty fields, and times to the minute, which is all a person's answer or a card's activity needs.
function lean(_key: string, value: unknown) {
  if (typeof value === "string") {
    const time = ISO.exec(value);
    return time?.groups ? `${time.groups.minute}Z` : value;
  }
  const empty = value === null || (Array.isArray(value) && value.length === 0);
  return empty ? undefined : value;
}
