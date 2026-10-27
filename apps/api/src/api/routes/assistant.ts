import { createRoute, z } from "@hono/zod-openapi";

import { ask, askStream, resolveAgent } from "#agent/assistant";
import { createConversation, getConversation } from "#agent/conversations";
import { body, errors, json, Ok, router } from "#api/router";
import {
  AutomationRunSchema,
  AutomationSchema,
  ConversationSchema,
  MemorySchema,
  MessageSchema,
  ScheduleSchema,
  TargetSchema,
  toAutomation,
  toConversation,
  toMemory,
  toMessages,
  toRun,
  toTarget,
} from "#api/schemas";
import { runAutomation } from "#automations/run";
import * as automations from "#automations/service";
import type { AppContext } from "#context";
import { getAutomationById, listAutomations } from "#db/queries/automations";
import { listConversations, listMessages } from "#db/queries/conversations";
import { listDeliveryTargets } from "#db/queries/delivery-targets";
import { listMemories } from "#db/queries/memories";
import {
  AUTOMATION_KINDS,
  MEMORY_KINDS,
  TARGET_KINDS,
  VISIBILITY,
} from "#db/schema";
import { createTarget, deleteTarget, deliver } from "#delivery/service";
import { badRequest } from "#lib/errors";
import { resolveMember } from "#members/service";
import { addMemory, forgetMemory } from "#memory/service";

const Id = z.object({ id: z.string() });
const Reply = z
  .object({
    conversation: ConversationSchema,
    reply: z
      .string()
      .nullable()
      .openapi({ description: "Markdown; null when no message was sent" }),
  })
  .openapi("AgentReply");

// A useChat UIMessage is accepted, but only its text parts are used.
const ChatMessage = z.union([
  z.string().min(1),
  z
    .object({
      role: z.literal("user").optional(),
      parts: z.array(
        z.looseObject({ type: z.string(), text: z.string().optional() })
      ),
    })
    .loose(),
]);
const textOf = (m: z.infer<typeof ChatMessage>) =>
  typeof m === "string"
    ? m
    : m.parts
        .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
        .join("")
        .trim();

export const assistantRoutes = router()
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/conversations",
      operationId: "conversation.create",
      tags: ["Assistant"],
      summary: "Ask an assistant something — yours, or a teammate's",
      description:
        "Address a person (their personal assistant answers) or an agent. Asking your own assistant gives it full access to your work and lets it act for you; asking a teammate's assistant gets read-only, team-visible answers — and if it can't help, it can leave your teammate a note.",
      request: body(
        z.object({
          to: z.string().default("me").openapi({
            description: 'Member id or handle (human or agent), or "me"',
            example: "@sam",
          }),
          message: z.string().min(1).optional().openapi({
            description:
              "Omit to just open a conversation (e.g. before streaming with /chat)",
          }),
        })
      ),
      responses: { 201: json(Reply, "Answered"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { to, message } = c.req.valid("json");
      const agent = await resolveAgent(ctx, await resolveMember(ctx, me, to));
      if (!message) {
        return c.json(
          {
            conversation: toConversation(
              await createConversation(ctx, agent, me)
            ),
            reply: null,
          },
          201
        );
      }
      const { conversation, reply } = await ask(ctx, me, { agent, message });
      return c.json({ conversation: toConversation(conversation), reply }, 201);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/conversations/{id}/chat",
      operationId: "conversation.chat",
      tags: ["Assistant"],
      summary:
        "Send a message and stream the answer (AI SDK UI-message stream, works with useChat)",
      description:
        "Streams tokens and tool activity as Server-Sent Events in the AI SDK UI-message protocol. Point `useChat`'s `DefaultChatTransport` here and send only the newest message (`prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1) } })`); the server keeps the history.",
      request: { params: Id, ...body(z.object({ message: ChatMessage })) },
      responses: {
        200: {
          content: { "text/event-stream": { schema: z.string() } },
          description: "UI message stream",
        },
        ...errors,
      },
    }),
    async (c) => {
      const message = textOf(c.req.valid("json").message);
      if (!message) {
        return c.json(
          {
            error: {
              code: "invalid_request",
              message: "The message has no text",
            },
          },
          400
        );
      }
      return await askStream(c.get("ctx"), c.get("member"), {
        conversationId: c.req.valid("param").id,
        message,
      });
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/conversations/{id}/messages",
      operationId: "conversation.send",
      tags: ["Assistant"],
      summary:
        "Continue a conversation (including replying to a brief in your inbox)",
      request: {
        params: Id,
        ...body(z.object({ message: z.string().min(1) })),
      },
      responses: { 200: json(Reply), ...errors },
    }),
    async (c) => {
      const { conversation, reply } = await ask(c.get("ctx"), c.get("member"), {
        conversationId: c.req.valid("param").id,
        message: c.req.valid("json").message,
      });
      return c.json({ conversation: toConversation(conversation), reply }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/conversations",
      operationId: "conversation.list",
      tags: ["Assistant"],
      responses: { 200: json(z.array(ConversationSchema)), ...errors },
    }),
    async (c) => {
      const rows = await listConversations(c.get("ctx").db, {
        askerId: c.get("member").id,
      });
      return c.json(rows.map(toConversation), 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/conversations/{id}",
      operationId: "conversation.get",
      tags: ["Assistant"],
      request: { params: Id },
      responses: {
        200: json(
          ConversationSchema.extend({ messages: z.array(MessageSchema) })
        ),
        ...errors,
      },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const conversation = await getConversation(
        ctx,
        c.get("member"),
        c.req.valid("param").id
      );
      return c.json(
        {
          ...toConversation(conversation),
          messages: toMessages(
            await listMessages(ctx.db, { conversationId: conversation.id })
          ),
        },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/memories",
      operationId: "memory.list",
      tags: ["Assistant"],
      summary: "What your assistant has learned about you (you can correct it)",
      request: {
        query: z.object({
          kind: z.enum(MEMORY_KINDS).optional(),
          q: z.string().optional(),
        }),
      },
      responses: { 200: json(z.array(MemorySchema)), ...errors },
    }),
    async (c) => {
      const { kind, q } = c.req.valid("query");
      const rows = await listMemories(c.get("ctx").db, {
        memberId: c.get("member").id,
        kinds: kind ? [kind] : undefined,
        q,
        includePrivate: true,
      });
      return c.json(rows.map(toMemory), 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/memories",
      operationId: "memory.create",
      tags: ["Assistant"],
      summary: "Tell your assistant something about how you work",
      request: body(
        z.object({
          content: z.string().min(1).openapi({
            example:
              "I own the payments service; ask me before changing retry logic",
          }),
          kind: z.enum(["profile", "fact"]).default("profile"),
          visibility: z.enum(VISIBILITY).default("team"),
        })
      ),
      responses: { 201: json(MemorySchema, "Saved"), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      const row = await addMemory(c.get("ctx"), {
        workspaceId: me.workspaceId,
        memberId: me.id,
        source: "self",
        ...c.req.valid("json"),
      });
      return c.json(toMemory(row), 201);
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/memories/{id}",
      operationId: "memory.forget",
      tags: ["Assistant"],
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await forgetMemory(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id
      );
      return c.json({ ok: true as const }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/delivery-targets",
      operationId: "target.list",
      tags: ["Delivery"],
      responses: { 200: json(z.array(TargetSchema)), ...errors },
    }),
    async (c) => {
      const rows = await listDeliveryTargets(c.get("ctx").db, {
        memberId: c.get("member").id,
      });
      return c.json(rows.map(toTarget), 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/delivery-targets",
      operationId: "target.create",
      tags: ["Delivery"],
      summary: "Add a place to receive briefs and notifications",
      description:
        "email: an address. slack: a channel id (C…) or your user id (U…) for a DM, plus the Slack connectionId. discord: a channel id plus connectionId, or a channel webhook URL. webhook: any https URL (works with ntfy, Pushover bridges, Zapier…).",
      request: body(
        z.object({
          kind: z.enum(TARGET_KINDS),
          address: z.string().min(1),
          label: z.string().optional(),
          connectionId: z.string().optional(),
        })
      ),
      responses: { 201: json(TargetSchema, "Created"), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      return c.json(
        toTarget(
          await createTarget(
            c.get("ctx"),
            me.workspaceId,
            me.id,
            c.req.valid("json")
          )
        ),
        201
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/delivery-targets/{id}/test",
      operationId: "target.test",
      tags: ["Delivery"],
      summary: "Send a test message",
      request: { params: Id },
      responses: {
        200: json(
          z.object({ delivered: z.boolean(), error: z.string().nullable() })
        ),
        ...errors,
      },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const { delivered, failed } = await deliver(
        ctx,
        me.id,
        [c.req.valid("param").id],
        {
          type: "test",
          subject: "Worklog test message",
          markdown: `Hi ${me.name} — this is where your Worklog briefs and notifications will arrive.`,
        }
      );
      return c.json(
        { delivered: delivered.length > 0, error: failed[0]?.error ?? null },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/delivery-targets/{id}",
      operationId: "target.delete",
      tags: ["Delivery"],
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await deleteTarget(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id
      );
      return c.json({ ok: true as const }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/automations",
      operationId: "automation.list",
      tags: ["Automations"],
      summary:
        "Your scheduled briefs, attention check, memory consolidation and custom automations",
      responses: { 200: json(z.array(AutomationSchema)), ...errors },
    }),
    async (c) => {
      const rows = await listAutomations(c.get("ctx").db, {
        memberId: c.get("member").id,
      });
      return c.json(rows.map(toAutomation), 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/automations",
      operationId: "automation.create",
      tags: ["Automations"],
      summary: "Create an automation",
      description:
        'Custom automations are instructions your assistant runs on a schedule, e.g. "Every Friday at 3pm, list my PRs still waiting on review and who has them." It stays quiet when there is nothing worth saying.',
      request: body(
        z.object({
          kind: z.enum(AUTOMATION_KINDS).default("custom"),
          name: z.string().min(1),
          schedule: ScheduleSchema,
          instructions: z.string().optional(),
          targetIds: z.array(z.string()).optional(),
          enabled: z.boolean().optional(),
        })
      ),
      responses: { 201: json(AutomationSchema, "Created"), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const input = c.req.valid("json");
      await assertOwnTargets(ctx, me.id, input.targetIds);
      return c.json(
        toAutomation(await automations.createAutomation(ctx, me, input)),
        201
      );
    }
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/automations/{id}",
      operationId: "automation.update",
      tags: ["Automations"],
      summary:
        "Change schedule, delivery targets, instructions, or turn it off",
      request: {
        params: Id,
        ...body(
          z.object({
            name: z.string().min(1).optional(),
            schedule: ScheduleSchema.optional(),
            instructions: z.string().nullable().optional(),
            targetIds: z.array(z.string()).optional(),
            enabled: z.boolean().optional(),
          })
        ),
      },
      responses: { 200: json(AutomationSchema), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      const patch = c.req.valid("json");
      await assertOwnTargets(ctx, me.id, patch.targetIds);
      return c.json(
        toAutomation(
          await automations.updateAutomation(
            ctx,
            me,
            c.req.valid("param").id,
            patch
          )
        ),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/v1/automations/{id}",
      operationId: "automation.delete",
      tags: ["Automations"],
      request: { params: Id },
      responses: { 200: json(Ok), ...errors },
    }),
    async (c) => {
      await automations.deleteAutomation(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id
      );
      return c.json({ ok: true as const }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/automations/{id}/run",
      operationId: "automation.run",
      tags: ["Automations"],
      summary: "Run it now (ignores active hours; doesn't change the schedule)",
      request: { params: Id },
      responses: {
        200: json(z.object({ status: z.string(), summary: z.string() })),
        ...errors,
      },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const row = await getAutomationById(ctx.db, {
        id: c.req.valid("param").id,
        memberId: c.get("member").id,
      });
      const { status, summary } = await runAutomation(ctx, row, {
        manual: true,
      });
      return c.json({ status, summary }, 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/automations/{id}/runs",
      operationId: "automation.runs",
      tags: ["Automations"],
      request: { params: Id },
      responses: { 200: json(z.array(AutomationRunSchema)), ...errors },
    }),
    async (c) => {
      const rows = await automations.listRuns(
        c.get("ctx"),
        c.get("member").id,
        c.req.valid("param").id
      );
      return c.json(rows.map(toRun), 200);
    }
  );

async function assertOwnTargets(
  ctx: AppContext,
  memberId: string,
  ids?: string[]
) {
  if (ids === undefined || ids.length === 0) {
    return;
  }
  const targets = await listDeliveryTargets(ctx.db, { memberId });
  const mine = new Set(targets.map((t) => t.id));
  const foreign = ids.filter((id) => !mine.has(id));
  if (foreign.length) {
    throw badRequest(`Unknown delivery target(s): ${foreign.join(", ")}`);
  }
}
