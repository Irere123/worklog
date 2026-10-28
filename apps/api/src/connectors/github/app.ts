import { createPrivateKey, sign } from "node:crypto";

import { z } from "zod";

import { call, callJson, ProviderError } from "#connectors/http";
import type { AppSpec, AppView, ConnectionView } from "#connectors/types";
import type { AppContext } from "#context";
import { badRequest, forbidden } from "#lib/errors";

const GITHUB = "https://github.com";
const API = "https://api.github.com";

/** GitHub Enterprise Server sets these; github.com needs neither. */
export const apiUrl = (credentials: Record<string, string>) =>
  credentials.apiUrl ?? API;
const webUrl = (credentials: Record<string, string>) =>
  credentials.webUrl ?? GITHUB;

const b64url = (value: string) => Buffer.from(value).toString("base64url");

/**
 * The app's own credential: an RS256 JWT, issued 60 s in the past against clock drift, for at
 * most the 10 minutes GitHub allows.
 */
export function appJwt(app: AppView, now: Date) {
  const seconds = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: app.appId })
  );
  const key = createPrivateKey(
    (app.credentials.privateKey ?? "").replaceAll("\\n", "\n")
  );
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    key
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export const headers = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
});

const Token = z.object({ token: z.string(), expires_at: z.string() });

// Installation tokens last an hour. Minted on demand and kept until five minutes before they
// expire, per process; never stored.
const tokens = new Map<string, { token: string; expiresAt: number }>();
const REFRESH_MS = 5 * 60_000;

export async function installationToken(
  ctx: AppContext,
  app: AppView,
  installationId: string
) {
  const key = `${app.appId}:${installationId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt - ctx.now().getTime() > REFRESH_MS) {
    return cached.token;
  }
  const res = await ctx.fetch(
    `${apiUrl(app.credentials)}/app/installations/${installationId}/access_tokens`,
    { method: "POST", headers: headers(appJwt(app, ctx.now())) }
  );
  // 404: uninstalled, perhaps while Worklog was down and missed the webhook. A 401 is about the
  // app itself (its key, its id, the clock), not this installation, so it revokes nothing.
  if (res.status === 404) {
    throw new ProviderError(
      `GitHub installation ${installationId} is gone`,
      "revoked",
      null,
      404
    );
  }
  if (res.status === 401) {
    throw new ProviderError(
      "GitHub refused the app's credentials: check its private key and app id, and the server's clock",
      "failed"
    );
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new ProviderError(
      `GitHub installation token: ${res.status} ${detail.slice(0, 200)}`,
      "failed"
    );
  }
  const minted = Token.parse(await res.json());
  tokens.set(key, {
    token: minted.token,
    expiresAt: new Date(minted.expires_at).getTime(),
  });
  return minted.token;
}

export function forgetToken(app: AppView, installationId: string) {
  tokens.delete(`${app.appId}:${installationId}`);
}

/** What a connection reads GitHub with: its installation's token, or a token pasted into it. */
export type GithubAuth = {
  api: string;
  token: () => Promise<string>;
  /** Drops a cached token GitHub refused, so the next `token()` mints a new one. */
  refresh?: () => void;
};

export function authFor(
  ctx: AppContext,
  conn: ConnectionView,
  app: AppView | null,
  installationId: string | null
): GithubAuth | null {
  if (installationId && app) {
    return {
      api: apiUrl(app.credentials),
      token: async () => await installationToken(ctx, app, installationId),
      refresh: () => {
        forgetToken(app, installationId);
      },
    };
  }
  const { token } = conn.secrets;
  if (!token) {
    return null;
  }
  const base = conn.settings.apiUrl;
  return {
    api: typeof base === "string" ? base : API,
    token: async () => await Promise.resolve(token),
  };
}

const UserToken = z.object({
  access_token: z.string().optional(),
  error: z.string().optional(),
});
const Installations = z.object({
  installations: z.array(z.object({ id: z.number() })),
});
const Installation = z.object({
  id: z.number(),
  account: z
    .object({ login: z.string(), type: z.string().optional() })
    .nullish(),
  repository_selection: z.string().optional(),
});

// Page by page: someone in a large organization can manage more than a page of installations.
async function canManage(
  ctx: AppContext,
  app: AppView,
  userToken: string,
  id: string
) {
  for (let page = 1; page <= 20; page += 1) {
    const mine = Installations.parse(
      await callJson(
        ctx,
        "GitHub user installations",
        `${apiUrl(app.credentials)}/user/installations?per_page=100&page=${page}`,
        { headers: headers(userToken) }
      )
    );
    if (mine.installations.some((i) => String(i.id) === id)) {
      return true;
    }
    if (mine.installations.length < 100) {
      return false;
    }
  }
  return false;
}

/**
 * The redirect's `installation_id` is only a claim: anyone can put any id in a URL. The code,
 * exchanged with the app's secret, says who came back, and only an installation that person can
 * see is connected.
 */
async function verifiedInstallation(
  ctx: AppContext,
  app: AppView,
  query: Record<string, string>
) {
  const id = query.installation_id;
  if (!id || !/^\d+$/u.test(id)) {
    throw badRequest(
      query.setup_action === "request"
        ? "The install is waiting for an organization owner to approve it. Connect it once they have."
        : "GitHub didn't say which installation this is"
    );
  }
  if (!query.code) {
    throw badRequest(
      "GitHub sent no code; the app must request user authorization during installation"
    );
  }
  const exchanged = UserToken.parse(
    await callJson(
      ctx,
      "GitHub OAuth",
      `${webUrl(app.credentials)}/login/oauth/access_token`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: app.credentials.clientId,
          client_secret: app.credentials.clientSecret,
          code: query.code,
        }),
      }
    )
  );
  if (!exchanged.access_token) {
    throw badRequest(
      `GitHub refused the code: ${exchanged.error ?? "unknown error"}`
    );
  }
  if (!(await canManage(ctx, app, exchanged.access_token, id))) {
    throw forbidden("That GitHub installation isn't one you can manage");
  }
  return Installation.parse(
    await callJson(
      ctx,
      "GitHub installation",
      `${apiUrl(app.credentials)}/app/installations/${id}`,
      { headers: headers(appJwt(app, ctx.now())) }
    )
  );
}

const AppInstallations = z.array(z.object({ id: z.number() }));

const InstallationEvent = z.object({
  action: z.string().optional(),
  installation: z
    .object({
      id: z.number(),
      account: z.object({ login: z.string() }).nullish(),
    })
    .optional(),
  repositories_added: z.array(z.object({ full_name: z.string() })).optional(),
});

const STATUS_ACTIONS: Record<
  string,
  { status: "active" | "suspended" | "revoked"; reason: string }
> = {
  deleted: { status: "revoked", reason: "the GitHub App was uninstalled" },
  suspend: { status: "suspended", reason: "the GitHub App was suspended" },
  unsuspend: { status: "active", reason: "the GitHub App was unsuspended" },
};

export const githubApp: AppSpec = {
  credentials: [
    { key: "clientId", required: true, description: "The app's Client ID" },
    { key: "clientSecret", required: true, description: "A client secret" },
    { key: "privateKey", required: true, description: "A private key (PEM)" },
    { key: "webhookSecret", required: true, description: "The webhook secret" },
    {
      key: "apiUrl",
      required: false,
      description:
        "GitHub Enterprise Server only: https://github.example.com/api/v3",
    },
    {
      key: "webUrl",
      required: false,
      description: "GitHub Enterprise Server only: https://github.example.com",
    },
  ],
  endpoints: { webhook: "" },
  fromEnv: (config) =>
    config.GITHUB_APP_ID &&
    config.GITHUB_APP_SLUG &&
    config.GITHUB_APP_PRIVATE_KEY &&
    config.GITHUB_APP_WEBHOOK_SECRET &&
    config.GITHUB_CLIENT_ID &&
    config.GITHUB_CLIENT_SECRET
      ? {
          appId: config.GITHUB_APP_ID,
          slug: config.GITHUB_APP_SLUG,
          name: config.GITHUB_APP_SLUG,
          credentials: {
            clientId: config.GITHUB_CLIENT_ID,
            clientSecret: config.GITHUB_CLIENT_SECRET,
            privateKey: config.GITHUB_APP_PRIVATE_KEY,
            webhookSecret: config.GITHUB_APP_WEBHOOK_SECRET,
          },
        }
      : null,
  route(received) {
    const parsed = InstallationEvent.safeParse(received.payload);
    const id = parsed.success ? parsed.data.installation?.id : undefined;
    return id === undefined ? null : String(id);
  },
  lifecycle(eventType, payload) {
    const parsed = InstallationEvent.safeParse(payload);
    if (!parsed.success) {
      return null;
    }
    const { action, repositories_added: added, installation } = parsed.data;
    if (eventType === "installation") {
      const change = STATUS_ACTIONS[action ?? ""];
      return change ? { type: "status", ...change } : null;
    }
    if (eventType === "installation_repositories" && action === "added") {
      return {
        type: "sync",
        streams: (added ?? []).map((r) => `repo:${r.full_name}`),
      };
    }
    if (eventType === "installation_target" && installation?.account) {
      return { type: "rename", name: `GitHub · ${installation.account.login}` };
    }
    return null;
  },
  async installations(ctx, app) {
    const ids = new Set<string>();
    for (let page = 1; page <= 100; page += 1) {
      const rows = AppInstallations.parse(
        await callJson(
          ctx,
          "GitHub app installations",
          `${apiUrl(app.credentials)}/app/installations?per_page=100&page=${page}`,
          { headers: headers(appJwt(app, ctx.now())) }
        )
      );
      for (const row of rows) {
        ids.add(String(row.id));
      }
      if (rows.length < 100) {
        return ids;
      }
    }
    // A list cut short would read as installations gone.
    throw new ProviderError(
      "GitHub listed more installations than Worklog reads",
      "failed"
    );
  },
  installUrl(app, state) {
    const web = webUrl(app.credentials);
    const path = web === GITHUB ? "apps" : "github-apps";
    return `${web}/${path}/${app.slug}/installations/new?state=${encodeURIComponent(state)}`;
  },
  async completeInstall(ctx, app, query) {
    const installation = await verifiedInstallation(ctx, app, query);
    const account = installation.account?.login ?? String(installation.id);
    return {
      externalId: String(installation.id),
      account,
      name: `GitHub · ${account}`,
      secrets: {},
      settings: { account },
    };
  },
};

/**
 * The app GitHub creates from a manifest. User authorization during install is what lets the
 * callback check who installed it; the same client id and secret sign people in.
 */
export function githubManifest(publicUrl: string, name: string) {
  return {
    name,
    url: publicUrl,
    hook_attributes: { url: `${publicUrl}/hooks/apps/github`, active: true },
    redirect_url: `${publicUrl}/oauth/github/app`,
    callback_urls: [
      `${publicUrl}/oauth/github/callback`,
      `${publicUrl}/api/auth/callback/github`,
    ],
    request_oauth_on_install: true,
    setup_on_update: true,
    public: false,
    default_permissions: {
      contents: "read",
      issues: "read",
      metadata: "read",
      pull_requests: "read",
      email_addresses: "read",
    },
    default_events: [
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
      "push",
      "release",
    ],
  };
}

const Conversion = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  html_url: z.string().optional(),
  client_id: z.string(),
  client_secret: z.string(),
  webhook_secret: z.string().nullable(),
  pem: z.string(),
});

/** Trades the manifest flow's one-hour code for the new app's credentials. */
export async function convertManifest(
  ctx: AppContext,
  code: string,
  api = API
) {
  const app = Conversion.parse(
    await callJson(
      ctx,
      "GitHub manifest conversion",
      `${api}/app-manifests/${code}/conversions`,
      {
        method: "POST",
        headers: { Accept: "application/vnd.github+json" },
      }
    )
  );
  if (!app.webhook_secret) {
    throw new ProviderError(
      "GitHub created the app without a webhook secret",
      "failed"
    );
  }
  return {
    appId: String(app.id),
    slug: app.slug,
    name: app.name,
    url: app.html_url ?? `https://github.com/apps/${app.slug}`,
    credentials: {
      clientId: app.client_id,
      clientSecret: app.client_secret,
      privateKey: app.pem,
      webhookSecret: app.webhook_secret,
    },
  };
}

/** Runs a call with the connection's token, once more with a fresh one if GitHub refuses it. */
export async function withToken(
  auth: GithubAuth,
  run: (token: string) => Promise<Response>
) {
  try {
    return await run(await auth.token());
  } catch (error) {
    // Only a refused token is worth a fresh one; an installation that's gone stays gone.
    if (
      !(error instanceof ProviderError) ||
      error.status !== 401 ||
      !auth.refresh
    ) {
      throw error;
    }
    auth.refresh();
    return await run(await auth.token());
  }
}

/** A GitHub REST call with the connection's credentials. */
export async function githubCall(
  ctx: AppContext,
  auth: GithubAuth,
  what: string,
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
) {
  return await withToken(
    auth,
    async (token) =>
      await call(ctx, what, `${auth.api}${path}`, {
        ...init,
        headers: { ...headers(token), ...init.headers },
      })
  );
}
