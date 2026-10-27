import { generateText, Output } from "ai";
import { z } from "zod";

import { TIMEOUTS } from "#ai/models";
import { UNTRUSTED_NOTE } from "#ai/prompts";
import type { AppContext } from "#context";
import {
  findConversationById,
  listMessagesAfter,
  setConversationRecap,
} from "#db/queries/conversations";
import type { ConversationRow, MessageRow } from "#db/queries/conversations";

// Stored messages are JSON, which runs about four characters per token; close enough for a budget.
const CHARS_PER_TOKEN = 4;
// Well inside the main model's window, and early enough that replaying stays cheap.
const COMPACT_AT_TOKENS = 64_000;
const KEEP_TOKENS = 16_000;
const MAX_LINE_CHARS = 4000;

// Summaries drop details, and these are the details a conversation depends on, so each kind gets
// its own field and identifiers are copied, not paraphrased ("The Compaction Cliff", arXiv 2608.22752).
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

// The newest messages that fit the budget, starting at a user turn: a tool result can't lead the
// replay, and providers expect a user message first. Returns the index of the first kept message.
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
  // The last turn alone is over budget: keep it whole rather than cut into it.
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
  const { output } = await generateText({
    model: models.fast,
    instructions: `You summarize the older part of a conversation with a Worklog assistant so the conversation can carry on without it. Keep every open loop, and copy every identifier exactly as written. Fold the previous summary in, if there is one, dropping only what is resolved and no longer matters. ${UNTRUSTED_NOTE}`,
    prompt: `${conversation.recap ? `Previous summary:\n${conversation.recap}\n\n` : ""}Messages:\n${transcript}`,
    output: Output.object({ schema: Recap }),
    timeout: TIMEOUTS.background,
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
