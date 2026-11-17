import { createRoute, z } from "@hono/zod-openapi";

import { getConnector } from "#connectors";
import {
  body,
  errors,
  json,
  requireAdmin,
  respond,
  router,
} from "#http/router";
import {
  App,
  InstallRequest,
  Link,
  ManifestRequest,
  ProviderParam,
  SaveAppRequest,
  SetupSecretHeaders,
} from "#http/schemas/apps";
import { describeApps, registerApp } from "#ingest/apps";
import { beginAppCreation, beginInstall } from "#ingest/install";
import { badRequest } from "#lib/errors";

export const appRoutes = router()
  .openapi(
    createRoute({
      method: "get",
      path: "/v1/apps",
      operationId: "app.list",
      tags: ["Connections"],
      summary:
        "Providers workspaces install with one click, and whether this server has registered each app (admins)",
      responses: { 200: json(z.array(App)), ...errors },
    }),
    async (c) => {
      requireAdmin(c.get("member"));
      return respond(c, z.array(App), await describeApps(c.get("ctx")), 200);
    }
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/v1/apps/{provider}",
      operationId: "app.save",
      tags: ["Connections"],
      summary:
        "Register this server's app with a provider, from its credentials",
      description:
        "For apps created by hand on the provider's site. Point the app's webhooks at `webhookUrls` and its redirect at `callbackUrl` (see `GET /v1/apps`). GitHub can create its app in one step instead: `POST /v1/apps/github/manifest`.",
      request: {
        params: ProviderParam,
        headers: SetupSecretHeaders,
        ...body(SaveAppRequest),
      },
      responses: { 200: json(App), ...errors },
    }),
    async (c) => {
      requireAdmin(c.get("member"));
      const app = await registerApp(
        c.get("ctx"),
        c.req.valid("param").provider,
        {
          ...c.req.valid("json"),
          secret: c.req.valid("header")["x-setup-secret"],
        }
      );
      return respond(c, App, app, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/apps/github/manifest",
      operationId: "app.createGithub",
      tags: ["Connections"],
      summary: "Create this server's GitHub App in one click",
      description:
        "Returns a link to open in a browser. GitHub asks to confirm the app, creates it with the right webhooks, permissions and redirects, and hands its credentials back to this server; then it goes straight on to installing it. The link works once, for an hour.",
      request: { headers: SetupSecretHeaders, ...body(ManifestRequest) },
      responses: { 200: json(Link), ...errors },
    }),
    async (c) => {
      const me = c.get("member");
      requireAdmin(me);
      const link = await beginAppCreation(c.get("ctx"), me, {
        ...c.req.valid("json"),
        secret: c.req.valid("header")["x-setup-secret"],
      });
      return respond(c, Link, link, 200);
    }
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/v1/apps/{provider}/install",
      operationId: "app.install",
      tags: ["Connections"],
      summary: "Connect this workspace through the server's app (admins)",
      description:
        "Returns a link to the provider's install page. Approving it there creates the connection, routes the app's webhooks to it and starts reading recent history. The link works once, for an hour.",
      request: {
        params: ProviderParam,
        body: {
          content: { "application/json": { schema: InstallRequest } },
          required: false,
        },
      },
      responses: { 200: json(Link), ...errors },
    }),
    async (c) => {
      const ctx = c.get("ctx");
      const me = c.get("member");
      requireAdmin(me);
      const { provider } = c.req.valid("param");
      if (!getConnector(provider)) {
        throw badRequest(`Unknown connector "${provider}"`);
      }
      const link = await beginInstall(ctx, me, provider, c.req.valid("json"));
      return respond(c, Link, link, 200);
    }
  );
