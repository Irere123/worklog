import { tool } from "ai";
import { z } from "zod";

import { getWorkspaceById } from "#db/queries/workspaces";
import { startOfLocalDate, timezoneOf } from "#lib/time";
import { addMemory } from "#memory/service";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function rememberTool({ ctx, owner }: Scope) {
  return tool({
    description: `Save something durable about ${owner.name}. profile = how they work, what they own, preferences; fact = knowledge worth keeping (decisions, context, why).`,
    inputSchema: z.object({
      content: z.string().describe("One self-contained statement"),
      kind: z.enum(["profile", "fact"]),
      private: z
        .boolean()
        .describe("True if teammates asking this assistant must not see it"),
      supersedes: z
        .array(z.string())
        .optional()
        .describe("Ids of memories this replaces"),
      aliases: z
        .array(z.string())
        .optional()
        .describe(
          "Other words someone might search for: synonyms, @handles, #card numbers"
        ),
      expiresOn: z
        .string()
        .optional()
        .describe(
          "YYYY-MM-DD after which it no longer holds, for time-bound things like leave or a deadline"
        ),
    }),
    execute: safe(
      async ({
        content,
        kind,
        private: isPrivate,
        supersedes,
        aliases,
        expiresOn,
      }) => {
        const tz = timezoneOf(
          owner,
          await getWorkspaceById(ctx.db, { id: owner.workspaceId })
        );
        const row = await addMemory(ctx, {
          workspaceId: owner.workspaceId,
          memberId: owner.id,
          kind,
          content,
          visibility: isPrivate ? "private" : "team",
          source: "agent",
          supersedes,
          aliases,
          expiresAt: expiresOn ? startOfLocalDate(expiresOn, tz, 1) : null,
        });
        return { ok: true, id: row.id };
      }
    ),
  });
}
