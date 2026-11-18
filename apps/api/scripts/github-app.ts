import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { escapeHtml } from "#automations/sanitize";
import { convertManifest, githubManifest } from "#connectors/github/app";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    name: { type: "string" },
    org: { type: "string" },
    private: { type: "boolean", default: false },
    out: { type: "string", default: "github-app.env" },
    port: { type: "string", default: "4590" },
  },
});

const url = values.url?.replace(/\/+$/u, "");
if (!url || !URL.canParse(url) || isLocal(url)) {
  console.error(
    'Usage: bun run github-app --url https://worklog.example.com [--org acme] [--name "Worklog"] [--private]\n\n--url is the deployed server\'s PUBLIC_URL, which GitHub must be able to reach.'
  );
  process.exit(1);
}

const { host } = new URL(url);
const name = values.name ?? `Worklog (${host})`.slice(0, 34);
const port = Number(values.port);
const state = randomBytes(24).toString("base64url");
const manifest = githubManifest(url, name, {
  public: !values.private,
  redirectUrl: `http://localhost:${port}/done`,
});
const target = values.org
  ? `https://github.com/organizations/${encodeURIComponent(values.org)}/settings/apps/new`
  : "https://github.com/settings/apps/new";

async function finish(code: string) {
  const app = await convertManifest({ fetch, now: () => new Date() }, code);
  const env = {
    GITHUB_APP_ID: app.appId,
    GITHUB_APP_SLUG: app.slug,
    GITHUB_CLIENT_ID: app.credentials.clientId,
    GITHUB_CLIENT_SECRET: app.credentials.clientSecret,
    GITHUB_APP_WEBHOOK_SECRET: app.credentials.webhookSecret,
    GITHUB_APP_PRIVATE_KEY: app.credentials.privateKey
      .trim()
      .replaceAll("\n", "\\n"),
  };
  await writeFile(
    values.out,
    `${Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600 }
  );
  console.log(
    `\nCreated ${app.name}: ${app.url}\nIts credentials are in ${values.out}. Set them as the server's environment variables, then delete the file.`
  );
}

const server = Bun.serve({
  port,
  hostname: "localhost",
  async fetch(req) {
    const at = new URL(req.url);
    if (at.pathname === "/") {
      return html(`<form method="post" action="${escapeHtml(`${target}?state=${state}`)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<p>GitHub will ask you to confirm the app's name, then send you back here.</p>
<button type="submit">Continue to GitHub</button></form>
<script>document.forms[0].submit()</script>`);
    }
    if (at.pathname === "/done") {
      const code = at.searchParams.get("code");
      if (at.searchParams.get("state") !== state || !code) {
        return html("<p>That isn't the app this command asked for.</p>", 400);
      }
      try {
        await finish(code);
      } catch (error) {
        console.error(error);
        return html("<p>GitHub refused the code. See the terminal.</p>", 502);
      }
      setTimeout(() => process.exit(0), 100);
      return html("<p>Done. The rest is in the terminal.</p>");
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Creating "${name}" for ${url}, ${values.private ? "installable only by its owner" : "installable by any GitHub account"}.

Open http://localhost:${server.port}/ in a browser on this machine. Over SSH, forward the port
first: ssh -L ${port}:localhost:${port} <this host>. If GitHub's redirect still can't reach this
machine, paste the address it leaves you on here.`);

for await (const line of console) {
  const pasted = line.trim();
  if (!pasted) {
    continue;
  }
  const fromUrl = URL.canParse(pasted) ? new URL(pasted) : null;
  if (fromUrl && fromUrl.searchParams.get("state") !== state) {
    console.error(
      "That address is from another attempt; paste the latest one."
    );
    continue;
  }
  const code = fromUrl ? fromUrl.searchParams.get("code") : pasted;
  if (!code) {
    console.error("No code in that address.");
    continue;
  }
  try {
    await finish(code);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  process.exit(0);
}

function isLocal(address: string) {
  const { hostname } = new URL(address);
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(name)}</title><body style="font-family:system-ui;max-width:36rem;margin:4rem auto;line-height:1.5">${body}`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
