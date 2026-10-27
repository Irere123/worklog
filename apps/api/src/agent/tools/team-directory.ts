import { tool } from "ai";
import { z } from "zod";

import { listMembers } from "#db/queries/members";

import { safe } from "./scope";
import type { Scope } from "./scope";

export function teamDirectoryTool({ ctx, owner }: Scope) {
  return tool({
    description:
      "List the people and agents in the workspace with their handles and roles.",
    inputSchema: z.object({}),
    execute: safe(async () => {
      const people = await listMembers(ctx.db, {
        workspaceId: owner.workspaceId,
      });
      return people.map((m) => ({
        handle: m.handle,
        name: m.name,
        kind: m.kind,
        title: m.title,
        agentOf: m.ownerId,
        provider: m.agentProvider,
      }));
    }),
  });
}
