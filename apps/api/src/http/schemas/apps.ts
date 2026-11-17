import { z } from "@hono/zod-openapi";

import { Timestamp } from "./common";

export const App = z
  .object({
    provider: z.string().openapi({ example: "github" }),
    configured: z.boolean().openapi({
      description: "This server has registered its app with the provider",
    }),
    createdVia: z.enum(["env", "manifest", "manual"]).nullable(),
    appId: z.string().nullable(),
    slug: z.string().nullable(),
    name: z.string().nullable(),
    unrouted: z.number().int().openapi({
      description:
        "Deliveries for installations no connection claims (installed on the provider's side, not here)",
    }),
    lastUnroutedAt: Timestamp.nullable(),
    rejections: z.number().int().openapi({
      description:
        "Deliveries the app's secret didn't verify: the secret here doesn't match the provider's",
    }),
    lastRejectedAt: Timestamp.nullable(),
    lastRejection: z.string().nullable(),
    credentials: z.array(
      z.object({
        key: z.string(),
        required: z.boolean(),
        description: z.string(),
      })
    ),
    webhookUrls: z.record(z.string(), z.string()).openapi({
      description: "The app's webhook URL(s), one per server",
    }),
    callbackUrl: z.string().openapi({
      description: "Where the provider sends people back after installing",
    }),
  })
  .openapi("App");

export const ProviderParam = z.object({ provider: z.string() });

export const SaveAppRequest = z.object({
  appId: z.string().optional(),
  slug: z
    .string()
    .optional()
    .openapi({ description: "GitHub: the app's URL name, for install links" }),
  name: z.string().optional(),
  credentials: z.record(z.string(), z.string()),
  replace: z.boolean().optional().openapi({
    description:
      "Replace existing credentials. Installations made with the old app stop working",
  }),
});

export const SetupSecretHeaders = z.object({
  "x-setup-secret": z.string().optional(),
});

const ReturnTo = z.url().optional().openapi({
  description:
    "The web app's origin, to send the browser back to the new connection when it's done. One of the server's web origins",
});

export const InstallRequest = z.object({ returnTo: ReturnTo });

export const ManifestRequest = z.object({
  name: z.string().min(1).max(34).optional().openapi({
    description: "Unique on GitHub. Default: Worklog (<your host>)",
  }),
  organization: z
    .string()
    .optional()
    .openapi({ description: "Create the app in this organization" }),
  replace: z.boolean().optional().openapi({
    description:
      "Replace the server's existing GitHub App. Installations made with it stop working",
  }),
  returnTo: ReturnTo,
});

export const Link = z
  .object({ url: z.string().openapi({ description: "Open in a browser" }) })
  .openapi("Link");

export const Source = z
  .object({
    id: z.string(),
    name: z.string(),
    private: z.boolean().optional(),
  })
  .openapi("Source");

export const SetSourcesRequest = z.object({
  ids: z.array(z.string()).max(1000),
});

export const SyncQueuedResponse = z.object({ queued: z.literal(true) });
