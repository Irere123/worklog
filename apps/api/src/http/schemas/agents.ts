import { z } from "@hono/zod-openapi";

import { Timestamp } from "./common";
import { MemberResponse } from "./members";

export const AgentApprovalQuery = z.object({
  clientId: z
    .string()
    .min(1)
    .openapi({ description: "The `client_id` from the approval page's query" }),
});

export const AgentApproval = z
  .object({
    signedInAs: z.string().openapi({
      description:
        "The email of the person approving, whose session the token will be issued to",
    }),
    client: z.object({
      id: z.string(),
      name: z.string(),
      uri: z.string().nullable(),
      verifiedHost: z.string().nullable().openapi({
        description:
          "The domain that publishes this app's metadata, which vouches for its name; null when the app registered itself and its name is only a claim",
      }),
      provider: z.string().openapi({
        description:
          "The `agentProvider` its agent will have, e.g. claude-code, cursor, copilot",
        example: "claude-code",
      }),
    }),
    workspaces: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        agent: MemberResponse.nullable().openapi({
          description:
            "The agent this app already is there, if it connected before",
        }),
      })
    ),
  })
  .openapi("AgentApproval");

export const AgentConnection = z
  .object({
    id: z.string(),
    agent: MemberResponse,
    ownerId: z.string(),
    clientName: z.string().nullable(),
    verifiedHost: z.string().nullable(),
    lastUsedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi("AgentConnection");
