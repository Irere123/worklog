import { generateText, Output } from "ai";
import { z } from "zod";

import { TIMEOUTS } from "#agent/models";
import { UNTRUSTED_NOTE } from "#agent/prompts";
import { raiseAttention } from "#attention/service";
import { listCards } from "#board/service";
import type { AppContext } from "#context";
import { findActivityById, updateActivityById } from "#db/queries/activities";
import { getCardByNumber, updateCardById } from "#db/queries/cards";
import { listMembers, listMembersByHandles } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import type { Visibility } from "#db/schema";
import { transact } from "#db/transact";

import { recordActivity } from "./service";

export const LOG_KINDS = ["entry", "decision", "blocker", "win"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export type LogInput = {
  text: string;
  via?: "text" | "voice" | "slack" | "discord" | "agent" | "api";
  kind?: LogKind;
  cardNumber?: number | null;
  visibility?: Visibility;
  occurredAt?: Date;
};

export async function logWork(
  ctx: AppContext,
  author: Member,
  input: LogInput
) {
  // 0 means no card, like a missing number.
  const cardNumber = input.cardNumber ?? 0;
  const card =
    cardNumber === 0
      ? null
      : await getCardByNumber(ctx.db, {
          workspaceId: author.workspaceId,
          number: cardNumber,
        });
  const kind = input.kind ?? "entry";
  const activity = await recordActivity(ctx, {
    workspaceId: author.workspaceId,
    actorId: author.id,
    source: "worklog",
    kind: `log.${kind}`,
    title: firstLine(input.text),
    body: input.text,
    cardId: card?.id ?? null,
    visibility: input.visibility ?? "team",
    occurredAt: input.occurredAt,
    data: { via: input.via ?? "text", structured: false },
  });
  if (!activity) {
    // Only events with an externalId can be duplicates, and log entries have none.
    throw new Error("A log entry was not recorded");
  }
  const enrichment =
    ctx.models && (!input.kind || !card)
      ? enrich(ctx, author, activity.id, input.text, {
          kindGiven: Boolean(input.kind),
          cardGiven: Boolean(card),
        })
      : Promise.resolve();
  return { activity, enrichment };
}

function firstLine(text: string) {
  const [line = ""] = text.trim().split("\n");
  return line.length > 100 ? `${line.slice(0, 97)}…` : line;
}

/** Structuring is best-effort: the entry is already recorded as typed. */
async function enrich(
  ctx: AppContext,
  author: Member,
  activityId: string,
  text: string,
  given: { kindGiven: boolean; cardGiven: boolean }
) {
  try {
    await structureLog(ctx, author, activityId, text, given);
  } catch (error) {
    console.error("[worklog] structuring failed", error);
  }
}

const Structured = z.object({
  title: z
    .string()
    .describe("A crisp past-tense headline for the entry, max 90 characters"),
  kind: z
    .enum(LOG_KINDS)
    .describe(
      "decision = a choice was made; blocker = waiting on someone/something; win = something shipped or resolved; entry = anything else"
    ),
  cardNumber: z
    .number()
    .int()
    .nullable()
    .describe(
      "The number of the card this entry is about, only if clearly one of the listed cards"
    ),
  blockedOn: z
    .array(z.string())
    .describe(
      "Handles of teammates the author is blocked on, only for blockers"
    ),
});

async function structureLog(
  ctx: AppContext,
  author: Member,
  activityId: string,
  text: string,
  given: { kindGiven: boolean; cardGiven: boolean }
) {
  const { models } = ctx;
  if (!models) {
    return;
  }
  const [openCards, team] = await Promise.all([
    listCards(ctx, author.workspaceId, { limit: 60 }).then((cs) =>
      cs.filter((c) => c.stage === "active" || c.stage === "triage")
    ),
    listMembers(ctx.db, {
      workspaceId: author.workspaceId,
      includeDeactivated: true,
    }),
  ]);
  const { output } = await generateText({
    model: models.fast,
    instructions: `You structure work-log entries for a team work tracker. ${UNTRUSTED_NOTE}`,
    prompt: `Author: ${author.name} (@${author.handle})
Open cards:
${openCards.map((c) => `#${c.number} ${c.title}`).join("\n") || "(none)"}
Teammates: ${team.map((t) => `@${t.handle} (${t.name})`).join(", ")}

Entry:
"""
${text}
"""`,
    output: Output.object({ schema: Structured }),
    timeout: TIMEOUTS.quick,
  });

  const current = await findActivityById(ctx.db, { id: activityId });
  if (!current) {
    return;
  }
  const suggested = given.cardGiven
    ? undefined
    : openCards.find((c) => c.number === output.cardNumber);
  const cardId = suggested?.id ?? current.cardId;
  const kind = given.kindGiven ? current.kind : `log.${output.kind}`;
  await transact(ctx, async (tx) => {
    await updateActivityById(tx.db, {
      id: activityId,
      set: {
        title: output.title || current.title,
        kind,
        cardId,
        data: { ...current.data, structured: true },
      },
    });
    if (cardId) {
      await updateCardById(tx.db, {
        id: cardId,
        set: { lastActiveAt: tx.now() },
      });
    }
  });

  if (kind === "log.blocker" && output.blockedOn.length > 0) {
    const blockers = await listMembersByHandles(ctx.db, {
      workspaceId: author.workspaceId,
      handles: output.blockedOn.map((h) => h.replace(/^@/u, "").toLowerCase()),
    });
    for (const m of blockers) {
      if (m.id === author.id) {
        continue;
      }
      await raiseAttention(ctx, {
        workspaceId: author.workspaceId,
        memberId: m.id,
        kind: "blocking",
        title: `${author.name} is blocked on you: ${output.title}`,
        body: text.slice(0, 400),
        activityId,
        cardId,
        fromId: author.id,
        priority: "high",
        dedupeKey: `blocking:${activityId}`,
      });
    }
  }
}
