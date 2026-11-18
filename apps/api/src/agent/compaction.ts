import { z } from "zod";

import type { AppContext } from "#context";
import {
  findConversationById,
  listMessagesAfter,
  setConversationRecap,
} from "#db/queries/conversations";
import type { ConversationRow, MessageRow } from "#db/queries/conversations";

import { structured } from "./generate";
import { prompt, UNTRUSTED_NOTE } from "./prompts";

const CHARS_PER_TOKEN = 4;
const COMPACT_AT_TOKENS = 64_000;
const COMPACT_NOW_TOKENS = 2 * COMPACT_AT_TOKENS;
const KEEP_TOKENS = 16_000;
const MAX_LINE_CHARS = 4000;

const Recap = z.object({
  openLoops: z
    .array(z.string())
    .describe("Promises, questions and tasks still open, and who owes them"),
  decisions: z.array(z.string()).describe("Decisions made, with their reasons"),
  identifiers: z
    .array(z.string())
    .describe(
      "Card numbers, PRs, links, ids, names and dates the conversation relies on, copied exactly"
    ),
  done: z.array(z.string()).describe("What was completed"),
  context: z
    .string()
    .describe("Anything else needed to carry on, in a few sentences"),
});

export function needsCompaction(replayChars: number) {
  return replayChars / CHARS_PER_TOKEN > COMPACT_AT_TOKENS;
}

export function mustCompactNow(replayChars: number) {
  return replayChars / CHARS_PER_TOKEN > COMPACT_NOW_TOKENS;
}

/**
 * Folds the older part of a conversation into its recap and stops replaying it; the messages stay
 * stored. The newest turns are kept verbatim. Without a model the older part is just dropped from
 * the replay.
 */
export async function compactConversation(
  ctx: AppContext,
  workspaceId: string,
  conversationId: string
) {
  const conversation = await findConversationById(ctx.db, {
    id: conversationId,
    workspaceId,
  });
  if (!conversation) {
    return;
  }
  const rows = await listMessagesAfter(ctx.db, {
    conversationId,
    afterSeq: conversation.recapThroughSeq,
  });
  const keep = keepFrom(rows);
  const last = rows[keep - 1];
  if (!needsCompaction(chars(rows)) || !last) {
    return;
  }
  const recap = ctx.models
    ? await writeRecap(ctx, conversation, rows.slice(0, keep))
    : conversation.recap;
  await setConversationRecap(ctx.db, {
    id: conversation.id,
    recap,
    fromSeq: conversation.recapThroughSeq,
    throughSeq: last.seq,
  });
}

function keepFrom(rows: MessageRow[]) {
  let budget = KEEP_TOKENS * CHARS_PER_TOKEN;
  let i = rows.length;
  while (i > 0) {
    const row = rows[i - 1];
    if (!row || size(row) > budget) {
      break;
    }
    budget -= size(row);
    i -= 1;
  }
  const start = rows.findIndex((r, index) => index >= i && r.role === "user");
  return start === -1
    ? Math.max(
        rows.findLastIndex((r) => r.role === "user"),
        0
      )
    : start;
}

async function writeRecap(
  ctx: AppContext,
  conversation: ConversationRow,
  older: MessageRow[]
) {
  const { models } = ctx;
  if (!models) {
    return conversation.recap;
  }
  const transcript = older
    .filter((r) => r.text)
    .map((r) => `${r.role}: ${r.text?.slice(0, MAX_LINE_CHARS)}`)
    .join("\n\n");
  const output = await structured(models, {
    model: "fast",
    instructions: [prompt("compaction"), UNTRUSTED_NOTE],
    prompt: `${conversation.recap ? `Previous summary:\n${conversation.recap}\n\n` : ""}Messages:\n${transcript}`,
    schema: Recap,
    timeout: "background",
  });
  return renderRecap(output, ctx.now());
}

function renderRecap(recap: z.infer<typeof Recap>, at: Date) {
  return [
    `_Summarized ${at.toISOString().slice(0, 10)}._`,
    list("Open loops", recap.openLoops),
    list("Decisions", recap.decisions),
    list("Identifiers", recap.identifiers),
    list("Done", recap.done),
    recap.context ? `### Context\n${recap.context}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function chars(rows: MessageRow[]) {
  return rows.reduce((total, r) => total + size(r), 0);
}

function size(row: MessageRow) {
  return JSON.stringify(row.content).length;
}

function list(title: string, items: string[]) {
  return items.length
    ? `### ${title}\n${items.map((i) => `- ${i}`).join("\n")}`
    : "";
}
