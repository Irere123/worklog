import { z } from "@hono/zod-openapi";

import { MemberResponse, Workspace } from "./members";

export const InviteCode = z.object({
  code: z.string().openapi({ description: "The last part of an invite link" }),
});

export const InviteLinkRequest = z.object({
  reset: z.boolean().optional().openapi({
    description: "Make a new link; the ones made before stop working",
  }),
});

export const InviteLink = z
  .object({
    url: z.string().openapi({ example: "https://worklog.example.com/join/…" }),
  })
  .openapi("InviteLink");

export const Invite = z
  .object({
    name: z.string().openapi({ description: "Who the invite is for" }),
    workspace: z.object({ name: z.string() }),
  })
  .openapi("Invite");

export const InviteAccepted = z
  .object({ member: MemberResponse, workspace: Workspace })
  .openapi("InviteAccepted");
