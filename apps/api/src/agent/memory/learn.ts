import { z } from "zod";

import { structured } from "#agent/generate";
import { addMemory, loadMemory, retireMemories } from "#agent/memory";
import { prompt, UNTRUSTED_NOTE } from "#agent/prompts";
import type { AppContext } from "#context";
import {
  listMessagesAfter,
  listUnlearnedRatings,
  setConversationLearned,
  setRatingsLearned,
} from "#db/queries/conversations";
import type { ConversationRow, MessageRow } from "#db/queries/conversations";
import { findMemberById } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import type { MemoryEvidence } from "#db/schema";
import { transact } from "#db/transact";
import { startOfLocalDate, timezoneOf } from "#lib/time";

// The newest messages of a conversation that went on for long, which is where corrections land.
const MAX_MESSAGES = 40;
const MAX_LINE_CHARS = 2000;
const RATED_REPLY_CHARS = 300;
const AUTOMATION_POST = "[Worklog automation:";

// Every field is required: providers' strict structured-output modes reject optional properties.
const Learned = z.object({
  remember: z
    .array(
      z.object({
        kind: z
          .enum(["profile", "fact"])
          .describe(
            "profile = how they work, what they own, preferences; fact = knowledge worth keeping"
          ),
        content: z.string().describe("One self-contained statement about them"),
        aliases: z
          .array(z.string())
          .describe(
            "Other words someone might search for: synonyms, @handles, #card numbers"
          ),
        expiresOn: z
          .string()
          .nullable()
          .describe(
            "YYYY-MM-DD after which it no longer holds, for time-bound knowledge; null if it lasts"
          ),
        confirmed: z
          .boolean()
          .describe(
            "True if they said it outright; false if you're inferring it from how they talk"
          ),
        evidence: z
          .array(z.string())
          .describe("Ids of their messages and ratings above that show it"),
        supersedes: z
          .array(z.string())
          .describe("Ids of the lines shown above that this one replaces"),
      })
    )
    .describe(
      "What this conversation taught that's worth keeping; usually empty"
    ),
  forget: z
    .array(z.string())
    .describe(
      "Ids of lines shown above that they said are wrong or no longer hold, with nothing to replace them"
    ),
});

/**
 * The memory pass after a conversation goes quiet: what the owner said to their own assistant
 * since the last pass, and how they rated its replies, becomes memory the same day instead of
 * waiting for the nightly one. Like the nightly pass, it learns only from the owner's own words,
 * and writes private memory: the conversation is between them and their assistant. Returns a
 * summary, or null if there was nothing to learn from.
 */
export async function learnFromConversation(
  ctx: AppContext,
  conversation: ConversationRow
) {
  // A teammate's words aren't the owner's, so only the owner's own conversations teach anything.
  const own = conversation.mode === "owner";
  const rows = await listMessagesAfter(ctx.db, {
    conversationId: conversation.id,
    afterSeq: conversation.learnedThroughSeq,
  });
  const ratings = own
    ? await listUnlearnedRatings(ctx.db, { conversationId: conversation.id })
    : [];
  if (!rows.length && !ratings.length) {
    return null;
  }
  const watermark = {
    id: conversation.id,
    fromSeq: conversation.learnedThroughSeq,
    throughSeq: rows.at(-1)?.seq ?? conversation.learnedThroughSeq,
  };
  const spoke =
    own && (ratings.length > 0 || rows.some((r) => ownerSaid(r) !== null));
  const owner = spoke
    ? await findMemberById(ctx.db, {
        id: conversation.askerId,
        workspaceId: conversation.workspaceId,
      })
    : undefined;
  if (!ctx.models || !owner) {
    await setConversationLearned(ctx.db, watermark);
    return null;
  }

  const memory = await loadMemory(ctx, owner.id, {
    includePrivate: true,
    journalDays: 0,
  });
  const quotes = new Map<string, MemoryEvidence>();
  // JSON with who said each thing, so a reply that quotes "Emma: …" can't pass for Emma speaking.
  const transcript = rows.slice(-MAX_MESSAGES).flatMap((r) => {
    const said = ownerSaid(r);
    if (said !== null) {
      const text = said.slice(0, MAX_LINE_CHARS);
      quotes.set(r.id, { kind: "said", at: r.createdAt.toISOString(), text });
      return [{ id: r.id, from: "owner", text }];
    }
    return r.role === "assistant" && r.text
      ? [{ from: "assistant", text: r.text.slice(0, MAX_LINE_CHARS) }]
      : [];
  });
  const rated = ratings.map((r) => {
    const ownerNote = r.note?.slice(0, MAX_LINE_CHARS) ?? null;
    quotes.set(r.id, {
      kind: "said",
      at: r.updatedAt.toISOString(),
      text: `Rated a reply ${r.rating}${ownerNote ? `: ${ownerNote}` : ""}`,
    });
    return {
      id: r.id,
      rating: r.rating,
      reply: (r.reply ?? "").slice(0, RATED_REPLY_CHARS),
      ownerNote,
    };
  });
  const output = await structured(ctx.models, {
    model: "fast",
    instructions: [prompt("learn", { name: owner.name }), UNTRUSTED_NOTE],
    prompt: `What you know about ${owner.name}:\n${memory.text}\n\nThe conversation ("owner" is ${owner.name}):\n${JSON.stringify(transcript)}${rated.length ? `\n\nHow ${owner.name} rated the assistant's replies:\n${JSON.stringify(rated)}` : ""}`,
    schema: Learned,
    timeout: "background",
  });

  const tz = timezoneOf(
    owner,
    await getWorkspaceById(ctx.db, { id: owner.workspaceId })
  );
  const shown = (ids: string[]) => ids.filter((id) => memory.shown.has(id));
  return await transact(ctx, async (tx) => {
    // Another pass got here first and learned these already.
    if (!(await setConversationLearned(tx.db, watermark))) {
      return null;
    }
    await setRatingsLearned(tx.db, { read: ratings, at: tx.now() });
    for (const r of output.remember) {
      await addMemory(tx, {
        workspaceId: owner.workspaceId,
        memberId: owner.id,
        kind: r.kind,
        content: r.content,
        aliases: r.aliases,
        visibility: "private",
        source: "agent",
        confirmed: r.confirmed,
        evidence: [...new Set(r.evidence)].flatMap((id) => {
          const quote = quotes.get(id);
          return quote ? [quote] : [];
        }),
        expiresAt: r.expiresOn
          ? (startOfLocalDate(r.expiresOn, tz, 1) ?? null)
          : null,
        supersedes: shown(r.supersedes),
      });
    }
    const forgotten = await retireMemories(tx, owner.id, shown(output.forget));
    return `learned ${output.remember.length}, forgot ${forgotten.length}`;
  });
}

// What the owner typed (stored apart from what Worklog added around it); null for anything else.
function ownerSaid(row: MessageRow) {
  const words = row.role === "user" ? row.text?.trim() : undefined;
  return words && !words.startsWith(AUTOMATION_POST) ? words : null;
}
