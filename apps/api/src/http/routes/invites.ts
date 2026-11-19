import { createRoute } from "@hono/zod-openapi";

import {
  body,
  errors,
  json,
  requireAdmin,
  respond,
  router,
} from "#http/router";
import {
  Invite,
  InviteAccepted,
  InviteCode,
  InviteLink,
  InviteLinkRequest,
} from "#http/schemas/invites";
import { MemberRef } from "#http/schemas/members";
import { acceptInvite, findInvite, inviteLink } from "#work/invites";

export const inviteRoutes = router()
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/members/{ref}/invite-link",
      operationId: "member.inviteLink",
      tags: ["People"],
      summary:
        "Get a link that lets an invited person join with any account (admins)",
      description:
        "For someone added but not yet joined. Whoever opens the link and signs in, with any email or account, joins as this person, so send it only to them. It works once, and stops working when they join, are removed, or you ask with `reset`.",
      request: { params: MemberRef, ...body(InviteLinkRequest) },
      responses: { 200: json(InviteLink), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      requireAdmin(me);
      return respond(
        c,
        InviteLink,
        await inviteLink(
          c.get("ctx"),
          me,
          c.req.valid("param").ref,
          c.req.valid("json")
        ),
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/invites/{code}",
      operationId: "invite.get",
      tags: ["People"],
      summary: "Who an invite link is for, before signing in",
      description:
        "Public: the link is the credential. 404 once it's used or replaced.",
      request: { params: InviteCode },
      responses: { 200: json(Invite), ...errors },
    }),
    async (c) => {
      const { member, workspace } = await findInvite(
        c.get("ctx"),
        c.req.valid("param").code
      );
      return respond(
        c,
        Invite,
        { name: member.name, workspace: { name: workspace.name } },
        200
      );
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/invites/{code}/accept",
      operationId: "invite.accept",
      tags: ["People"],
      summary:
        "Join the workspace an invite link is for, as the signed-in person",
      request: { params: InviteCode },
      responses: { 200: json(InviteAccepted), ...errors },
    }),
    async (c) =>
      respond(
        c,
        InviteAccepted,
        await acceptInvite(
          c.get("ctx"),
          c.get("user"),
          c.req.valid("param").code
        ),
        200
      )
  );
