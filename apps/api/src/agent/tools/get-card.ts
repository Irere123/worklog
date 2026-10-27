import { tool } from "ai";
import { z } from "zod";

import { getCardDetail } from "#board/service";
import { listActivities } from "#db/queries/activities";

import { privateFor, safe } from "./scope";
import type { Scope } from "./scope";

export function getCardTool(scope: Scope) {
  const { ctx, owner } = scope;
  return tool({
    description:
      "Full detail for one card: description, comments and its recent activity.",
    inputSchema: z.object({ number: z.number().int() }),
    execute: safe(async ({ number }) => {
      const card = await getCardDetail(ctx, owner.workspaceId, number);
      const history = await listActivities(ctx.db, {
        workspaceId: owner.workspaceId,
        privateFor: privateFor(scope),
        cardId: card.id,
        limit: 20,
      });
      return {
        ...card,
        comments: card.comments.map((c) => ({
          authorId: c.authorId,
          body: c.body,
          at: c.createdAt.toISOString(),
        })),
        history: history.map((a) => ({
          at: a.occurredAt.toISOString(),
          kind: a.kind,
          title: a.title,
          detail: a.body,
        })),
      };
    }),
  });
}
