import { z } from "@hono/zod-openapi";

export const Transcript = z
  .object({
    text: z.string().openapi({
      description:
        "What was said, with the workspace's own names spelled right. Empty when nothing was.",
    }),
  })
  .openapi("Transcript");
