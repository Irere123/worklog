import { Scalar } from "@scalar/hono-api-reference";
import type { ErrorHandler } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";

import type { AppContext } from "./context";
import { authMiddleware } from "./http/auth";
import { healthReport } from "./http/health";
import { hookRoutes } from "./http/hooks";
import { oauthRoutes } from "./http/oauth";
import { router } from "./http/router";
import { activityRoutes } from "./http/routes/activity";
import { agentRoutes } from "./http/routes/agent";
import { appRoutes } from "./http/routes/apps";
import { attentionRoutes } from "./http/routes/attention";
import { automationRoutes } from "./http/routes/automations";
import { boardRoutes } from "./http/routes/board";
import { briefRoutes } from "./http/routes/briefs";
import { connectionRoutes } from "./http/routes/connections";
import { deliveryRoutes } from "./http/routes/delivery";
import { eventRoutes } from "./http/routes/events";
import { identityRoutes } from "./http/routes/identities";
import { memberRoutes } from "./http/routes/members";
import { memoryRoutes } from "./http/routes/memory";
import {
  authConfigRoutes,
  sessionRoutes,
  setupRoutes,
} from "./http/routes/setup";
import { transcriptionRoutes } from "./http/routes/transcriptions";
import { workRoutes } from "./http/routes/work";
import { traceRequests } from "./http/trace";
import { webAppRoutes } from "./http/web";
import { webOrigins } from "./lib/auth";
import { ApiError } from "./lib/errors";
import { log } from "./telemetry/log";
import { activeSpan } from "./telemetry/trace";

export const API_INFO = {
  title: "Worklog API",
  version: "0.1.0",
  description: [
    "One server, many clients. Worklog answers three questions for a team of humans and agents:",
    "**what is everyone working on**, **what needs me**, and **what does my teammate's assistant know**.",
    "",
    "- **Board** — Fizzy-style cards: Maybe? → your columns → Not now / Done; untouched cards drift to Not now.",
    "- **Work stream** — GitHub, Slack, Discord, manual logs and agents, normalized.",
    "- **Attention, briefs & automations** — the proactive assistant: morning briefs, weekly wraps, pings only when something is blocked on you.",
    "- **Assistant** — ask yours, or a teammate's, about the work.",
    "",
    "**Auth:** people sign in (email link, GitHub, Discord, Slack — see `GET /v1/auth/config`) and use a session cookie or `Authorization: Bearer <session token>`; agents and integrations use API keys (`Authorization: Bearer wl_…`). Pick a workspace with `x-worklog-workspace`.",
    "Realtime: `GET /v1/events` (SSE, resumable).",
  ].join("\n"),
};

const handleError: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { error: { code: err.code, message: err.message } },
      err.status
    );
  }
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  activeSpan()?.fail(err);
  log.error("api: unhandled error", {
    error: err,
    route: `${c.req.method} ${routePath(c)}`,
  });
  return c.json(
    { error: { code: "internal", message: "Something went wrong" } },
    500
  );
};

export function createApp(ctx: AppContext) {
  const app = router();

  app.use("*", traceRequests());

  // Cookie sessions only from our own web origins; anyone may call with an API key (no cookies → no CSRF).
  const trusted = new Set(webOrigins(ctx.config));
  app.use(
    "*",
    cors({
      origin: (origin) => (trusted.has(origin) ? origin : "*"),
      credentials: true,
      allowHeaders: [
        "authorization",
        "content-type",
        "x-worklog-workspace",
        "last-event-id",
      ],
      exposeHeaders: [
        "set-auth-token",
        "x-worklog-conversation",
        "x-worklog-trace",
      ],
    })
  );
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });

  app.on(
    ["GET", "POST"],
    "/api/auth/*",
    async (c) => await ctx.auth.handler(c.req.raw)
  );
  // JSON only: event streams and the chat's stream must reach the client as they're written.
  app.use("/v1/*", compress({ contentTypeFilter: /^application\/json/u }));
  app.use("/v1/*", authMiddleware(ctx));

  app.onError(handleError);
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "not_found",
          message: `No route for ${c.req.method} ${c.req.path}`,
        },
      },
      404
    )
  );

  app.get("/health", async (c) => {
    const { status, body } = await healthReport(ctx);
    return c.json(body, status);
  });

  app
    .route("/", setupRoutes)
    .route("/", authConfigRoutes)
    .route("/", sessionRoutes)
    .route("/", memberRoutes)
    .route("/", identityRoutes)
    .route("/", boardRoutes)
    .route("/", activityRoutes)
    .route("/", workRoutes)
    .route("/", attentionRoutes)
    .route("/", briefRoutes)
    .route("/", agentRoutes)
    .route("/", transcriptionRoutes)
    .route("/", memoryRoutes)
    .route("/", deliveryRoutes)
    .route("/", automationRoutes)
    .route("/", connectionRoutes)
    .route("/", appRoutes)
    .route("/", eventRoutes)
    .route("/", hookRoutes())
    .route("/", oauthRoutes());

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description:
      "An API token from POST /v1/setup or POST /v1/members/{ref}/tokens",
  });
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: API_INFO,
    servers: [{ url: ctx.config.PUBLIC_URL }],
    security: [{ bearerAuth: [] }],
  });
  app.get("/docs", Scalar({ url: "/openapi.json", pageTitle: "Worklog API" }));

  if (ctx.config.WEB_DIST) {
    app.route("/", webAppRoutes(ctx.config.WEB_DIST));
  }

  return app;
}

export type App = ReturnType<typeof createApp>;
