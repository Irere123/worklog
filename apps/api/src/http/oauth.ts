import { Hono } from "hono";
import type { Context } from "hono";

import { escapeHtml } from "#automations/sanitize";
import { githubManifest } from "#connectors/github/app";
import { ProviderError } from "#connectors/http";
import type { AppContext } from "#context";
import { completeInstall, finishAppCreation } from "#ingest/install";
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
 * Where people's browsers land: GitHub's app-creation form, and the providers' redirects after
 * creating or installing an app. The single-use state from the API call that started it is the
 * only authority here.
 */
export function oauthRoutes() {
  const app = new Hono<OAuthEnv>();

  app.get("/oauth/github/manifest", (c) => {
    const ctx = c.get("ctx");
    const state = c.req.query("state") ?? "";
    const name = c.req.query("name") ?? "Worklog";
    const org = c.req.query("organization");
    const target = org
      ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new`
      : "https://github.com/settings/apps/new";
    const manifest = JSON.stringify(
      githubManifest(ctx.config.PUBLIC_URL, name)
    );
    return page(
      "Create the GitHub App",
      `<form method="post" action="${escapeHtml(`${target}?state=${encodeURIComponent(state)}`)}">
<input type="hidden" name="manifest" value="${escapeHtml(manifest)}">
<p>GitHub will ask you to confirm the app's name, then bring you back here to install it.</p>
<button type="submit">Continue to GitHub</button></form>
<script>document.forms[0].submit()</script>`
    );
  });

  app.get(
    "/oauth/github/app",
    async (c) =>
      await shown(async () => {
        const done = await finishAppCreation(c.get("ctx"), c.req.query());
        if (done.type === "orphaned") {
          return page(
            "Another GitHub App was registered meanwhile",
            `<p>This server kept the app it already had. The one just created, <a href="${escapeHtml(done.url)}">${escapeHtml(done.slug)}</a>, isn't used: delete it in its settings on GitHub.</p>`,
            409
          );
        }
        return done.type === "install"
          ? c.redirect(done.url, 302)
          : page("GitHub App created", "<p>Install it from Worklog.</p>");
      })
  );

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
        const conn = await completeInstall(ctx, c.req.param("provider"), query);
        return page(
          "Connected",
          `<p>${escapeHtml(conn.name)} is connected to Worklog. Recent history is on its way into your work stream; you can close this tab.</p>`
        );
      })
  );

  return app;
}
