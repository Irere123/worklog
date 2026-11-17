import { Hono } from "hono";
import type { Context } from "hono";

import { escapeHtml } from "#automations/sanitize";
import { ProviderError } from "#connectors/http";
import type { AppContext } from "#context";
import { completeInstall } from "#ingest/install";
import { ApiError } from "#lib/errors";
import { log } from "#telemetry/log";

type OAuthEnv = { Variables: { ctx: AppContext } };

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui;max-width:36rem;margin:4rem auto;line-height:1.5"><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

// These are browser redirects, so failures become a page a person can read, not JSON.
async function shown(run: () => Promise<Response>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) {
      return page(
        "That didn't work",
        `<p>${escapeHtml(error.message)}</p>`,
        error.status
      );
    }
    if (error instanceof ProviderError) {
      return page(
        "The provider said no",
        `<p>${escapeHtml(error.message)}</p>`,
        400
      );
    }
    log.error("oauth: install failed", { error });
    return page(
      "That didn't work",
      "<p>Something went wrong. Try again from Worklog.</p>",
      500
    );
  }
}

/**
 * Where people's browsers land: the providers' redirects after installing an app. The single-use
 * state from the API call that started it is the only authority here.
 */
export function oauthRoutes() {
  const app = new Hono<OAuthEnv>();

  app.get(
    "/oauth/:provider/callback",
    async (c: Context<OAuthEnv, "/oauth/:provider/callback">) =>
      await shown(async () => {
        const ctx = c.get("ctx");
        const query = c.req.query();
        // Editing an installation on GitHub's side comes back here without a state: there is
        // nothing to finish, and the change reaches Worklog by webhook.
        if (!query.state && query.setup_action === "update") {
          return page(
            "Saved",
            "<p>The change reaches Worklog on its own; you can close this tab.</p>"
          );
        }
        const { connection, returnTo } = await completeInstall(
          ctx,
          c.req.param("provider"),
          query
        );
        if (returnTo) {
          return c.redirect(
            `${returnTo}/settings/connections/${encodeURIComponent(connection.id)}`,
            302
          );
        }
        return page(
          "Connected",
          `<p>${escapeHtml(connection.name)} is connected to Worklog. Recent history is on its way into your work stream; you can close this tab.</p>`
        );
      })
  );

  return app;
}
