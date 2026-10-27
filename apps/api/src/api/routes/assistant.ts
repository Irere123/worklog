import { createRoute, z } from "@hono/zod-openapi";

import { ask, askStream, resolveAgent } from "#agent/assistant";
import { createConversation, getConversation } from "#agent/conversations";
import { MAX_VOICE_CHARS, setVoice } from "#agent/voice";
import { body, errors, json, Ok, router } from "#api/router";
import {
  AutomationRunSchema,
  AutomationSchema,
  ConversationSchema,
  MemoryExportSchema,
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
  toVoice,
  VoiceSchema,
} from "#api/schemas";
import { runAutomation } from "#automations/run";
import * as automations from "#automations/service";
import type { AppContext } from "#context";
import { getAutomationById, listAutomations } from "#db/queries/automations";
import { listConversations, listMessages } from "#db/queries/conversations";
import { listDeliveryTargets } from "#db/queries/delivery-targets";
import { listMemories, listMemoryLineage } from "#db/queries/memories";
import { findVoice, listVoices } from "#db/queries/voices";
import {
  AUTOMATION_KINDS,
  MEMORY_KINDS,
  TARGET_KINDS,
  VISIBILITY,
} from "#db/schema";
import {
  createTarget,
  deleteTarget,
  deliver,
  updateTarget,
} from "#delivery/service";
import { badRequest, notFound } from "#lib/errors";
import { resolveMember } from "#members/service";
import { exportMemory } from "#memory/export";
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
      const ctx = c.get("ctx");
      const rows = await listMemories(ctx.db, {
        memberId: c.get("member").id,
        kinds: kind ? [kind] : undefined,
        q,
        includePrivate: true,
        now: ctx.now(),
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
          aliases: z
            .array(z.string())
            .optional()
            .openapi({ example: ["billing", "@emma"] }),
          expiresAt: z.iso
            .datetime()
            .optional()
            .openapi({ description: "Stop recalling it after this" }),
        })
      ),
      responses: { 201: json(MemorySchema, "Saved"), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      const { expiresAt, ...input } = c.req.valid("json");
      const row = await addMemory(c.get("ctx"), {
        workspaceId: me.workspaceId,
        memberId: me.id,
        source: "self",
        ...input,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
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
      path: "/v1/memories/export",
      operationId: "memory.export",
      tags: ["Assistant"],
      summary: "Everything your assistant knows about you, as Markdown files",
      description:
        "Split by visibility, so you can share `team/` and keep `private/` to yourself. The files only change when your memory does, so committing each export to a git repo keeps a history of what your assistant learned.",
      responses: { 200: json(MemoryExportSchema), ...errors },
    }),
    async (c) =>
      c.json({ files: await exportMemory(c.get("ctx"), c.get("member")) }, 200)
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/memories/{id}/history",
      operationId: "memory.history",
      tags: ["Assistant"],
      summary:
        "Where a memory came from: the lines it replaced and what replaced it",
      description:
        "Oldest first, including the memory itself. Follow `supersededBy` to see which line replaced which.",
      request: { params: Id },
      responses: { 200: json(z.array(MemorySchema)), ...errors },
    }),
    async (c) => {
      const rows = await listMemoryLineage(c.get("ctx").db, {
        memberId: c.get("member").id,
        id: c.req.valid("param").id,
      });
      if (!rows.length) {
        throw notFound("Memory");
      }
      return c.json(rows.map(toMemory), 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/voice",
      operationId: "voice.get",
      tags: ["Assistant"],
      summary: "Your instructions for how your assistant speaks for you",
      responses: { 200: json(VoiceSchema), ...errors },
    }),
    async (c) => {
      const row = await findVoice(c.get("ctx").db, {
        memberId: c.get("member").id,
      });
      return c.json(toVoice(row), 200);
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/v1/voice",
      operationId: "voice.set",
      tags: ["Assistant"],
      summary: "Tell your assistant how to speak for you",
      description:
        "Every conversation with your assistant follows it, teammates' included, so treat it as visible to your team and keep anything private in private memory. Your assistant can't change it; each save is kept, and an empty one clears it.",
      request: body(
        z.object({
          content: z.string().max(MAX_VOICE_CHARS).openapi({
            example:
              "Sign off as Em. Send anyone asking about payments to #payments-oncall first.",
          }),
        })
      ),
      responses: { 200: json(VoiceSchema), ...errors },
    }),
    async (c) => {
      const row = await setVoice(
        c.get("ctx"),
        c.get("member"),
        c.req.valid("json").content
      );
      return c.json(toVoice(row), 200);
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/voice/history",
      operationId: "voice.history",
      tags: ["Assistant"],
      summary: "Every version of your instructions, newest first",
      responses: { 200: json(z.array(VoiceSchema)), ...errors },
    }),
    async (c) => {
      const rows = await listVoices(c.get("ctx").db, {
        memberId: c.get("member").id,
        limit: 100,
      });
      return c.json(rows.map(toVoice), 200);
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
        "email: an address. slack: a channel id (C…) or your user id (U…) for a DM, plus the Slack connectionId. discord: a channel id plus connectionId, or a channel webhook URL. webhook: any https URL (works with ntfy, Pushover bridges, Zapier…). Only your own email address and a Slack DM to you start as private; set `visibility` to private for anything else only you read, such as your own ntfy topic.",
      request: body(
        z.object({
          kind: z.enum(TARGET_KINDS),
          address: z.string().min(1),
          label: z.string().optional(),
          connectionId: z.string().optional(),
          visibility: z.enum(VISIBILITY).optional(),
        })
      ),
      responses: { 201: json(TargetSchema, "Created"), ...errors },
    }),
    async (c) =>
      c.json(
        toTarget(
          await createTarget(c.get("ctx"), c.get("member"), c.req.valid("json"))
        ),
        201
      )
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/v1/delivery-targets/{id}",
      operationId: "target.update",
      tags: ["Delivery"],
      summary: "Rename a target, or say who reads it",
      request: {
        params: Id,
        ...body(
          z.object({
            label: z.string().min(1).optional(),
            visibility: z.enum(VISIBILITY).optional(),
          })
        ),
      },
      responses: { 200: json(TargetSchema), ...errors },
    }),
    async (c) =>
      c.json(
        toTarget(
          await updateTarget(
            c.get("ctx"),
            c.get("member").id,
            c.req.valid("param").id,
            c.req.valid("json")
          )
        ),
        200
      )
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
