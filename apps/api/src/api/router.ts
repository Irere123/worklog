import { OpenAPIHono, z } from "@hono/zod-openapi";

import type { AppContext } from "#context";
import { forbidden } from "#lib/errors";
import { canActFor } from "#members/service";
import type { Member, SignedInUser } from "#members/service";

import { ErrorSchema } from "./schemas";

export type Env = {
  Variables: { ctx: AppContext; member: Member; user: SignedInUser | null };
};

export function router() {
  return new OpenAPIHono<Env>({
    defaultHook: (result, c) =>
      result.success
        ? undefined
        : c.json(
            {
              error: {
                code: "invalid_request",
                message: z.prettifyError(result.error),
                issues: result.error.issues,
              },
            },
            400
          ),
  });
}

export const json = <T extends z.ZodType>(schema: T, description = "OK") => ({
  content: { "application/json": { schema } },
  description,
});

export const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

export const errors = {
  400: json(ErrorSchema, "Invalid request"),
  401: json(ErrorSchema, "Missing or invalid credentials"),
  404: json(ErrorSchema, "Not found"),
} as const;

export const Ok = z.object({ ok: z.literal(true) }).openapi("Ok");

export function requireAdmin(member: Member) {
  if (member.role !== "owner" && member.role !== "admin") {
    throw forbidden("Only workspace admins can do this");
  }
}

export function requireSelfOrAdmin(viewer: Member, target: Member) {
  if (!canActFor(viewer, target)) {
    throw forbidden("You can only do this for yourself or agents you own");
  }
}
