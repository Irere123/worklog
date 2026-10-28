import type {
  AppView,
  ConnectionView,
  Connector,
  Normalized,
  Source,
  SyncSpec,
} from "#connectors/types";
import { hmacHex, safeEqual, shortHash } from "#lib/crypto";

import { authFor, githubApp } from "./github/app";
import type { GithubAuth } from "./github/app";
import { normalizeGithubLike, parsePayload } from "./github/events";
import type { Payload } from "./github/events";
import { asGithubReview } from "./github/gitea-events";
import { giteaHooks } from "./github/gitea-hooks";
import { giteaSync, normalizeGiteaPage } from "./github/gitea-sync";
import {
  installationRepos,
  normalizeSyncPage,
  readRepo,
  reposOf,
} from "./github/sync";

export { normalizeGithubLike } from "./github/events";

const SETTINGS_DOC = [
  {
    key: "boardId",
    description: "Board where new issues land as cards in Maybe? (optional)",
  },
  {
    key: "repos",
    description:
      'Only these repositories, e.g. ["acme/api"] (optional; default all)',
  },
  {
    key: "bots",
    description:
      '"quiet" (default: keep only bot PRs/releases), "drop", or "keep"',
  },
  {
    key: "ignoreKinds",
    description: 'Event kinds to never record, e.g. ["code.pushed"]',
  },
];

function normalize(
  ns: string,
  input: { eventType: string; payload: unknown; receivedAt: Date },
  settings: Record<string, unknown>
): Normalized {
  if (input.eventType === "sync.github") {
    return normalizeSyncPage(ns, input.payload, input.receivedAt, settings);
  }
  if (input.eventType === "sync.gitea") {
    return normalizeGiteaPage(ns, input.payload, input.receivedAt, settings);
  }
  const review = ns.startsWith("gitea:")
    ? asGithubReview(input.eventType, input.payload)
    : null;
  if (review) {
    const { repository } = parsePayload(input.payload);
    return normalizeGithubLike(
      ns,
      "pull_request_review",
      { ...review, repository },
      input.receivedAt,
      settings
    );
  }
  return normalizeGithubLike(
    ns,
    input.eventType,
    input.payload,
    input.receivedAt,
    settings
  );
}

const authOf = (
  ctx: Parameters<SyncSpec["read"]>[0],
  conn: ConnectionView,
  app: AppView | null
) => authFor(ctx, conn, app, conn.externalId);

function required(auth: GithubAuth | null) {
  if (!auth) {
    throw new Error(
      "This GitHub connection has no app installation or token to read with"
    );
  }
  return auth;
}

const REPO_STREAM = /^repo:(?<name>[^/\s]+\/[^/\s]+)$/u;

/**
 * History and catch-up through the API, for an app installation or a connection with a `token`.
 * An installation reads every repo it was given (narrowed by `repos`); a token reads `repos`.
 */
const githubSync: SyncSpec = {
  available: (conn, app) =>
    Boolean((conn.externalId && app) ?? conn.secrets.token),
  async streams(ctx, conn, app) {
    const wanted = reposOf(conn);
    const names = conn.externalId
      ? await installationRepos(ctx, required(authOf(ctx, conn, app)))
      : wanted;
    return names.map((n) => `repo:${n}`);
  },
  wants(conn, stream) {
    const wanted = reposOf(conn);
    const name = REPO_STREAM.exec(stream)?.groups?.name;
    return wanted.length === 0 || (name !== undefined && wanted.includes(name));
  },
  async read(ctx, conn, app, stream, cursor, window) {
    const name = REPO_STREAM.exec(stream)?.groups?.name;
    if (!name) {
      return { page: null, cursor: {}, done: true };
    }
    return await readRepo(
      ctx,
      required(authOf(ctx, conn, app)),
      name,
      cursor,
      window
    );
  },
};

async function githubRepos(
  ctx: Parameters<SyncSpec["read"]>[0],
  conn: ConnectionView,
  app: AppView | null
): Promise<Source[]> {
  const auth = authOf(ctx, conn, app);
  if (!auth || !conn.externalId) {
    return reposOf(conn).map((name) => ({ id: name, name }));
  }
  const names = await installationRepos(ctx, auth);
  return names.map((name) => ({ id: name, name }));
}

// Stored as it came, so a replay reads everything it said; read through `parsePayload`.
function parse(rawBody: string): object | null {
  try {
    const value: unknown = JSON.parse(rawBody);
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return null;
  }
}

// The repo id survives renames. Deliveries without a repo (installation events) share lane 0.
function partitionOf(p: Payload) {
  const repo = p.repository;
  if (repo?.id !== undefined) {
    return String(repo.id);
  }
  return repo?.full_name ?? "";
}

export const githubConnector: Connector = {
  id: "github",
  name: "GitHub",
  description:
    "Pull requests, reviews, issues, comments, pushes and releases. Review requests, assignments and @mentions become attention items.",
  secrets: [
    {
      key: "webhookSecret",
      required: true,
      description:
        "The webhook's secret (Settings → Webhooks). Not needed when installed through the GitHub App",
    },
    {
      key: "token",
      required: false,
      description:
        "A fine-grained token with read access to `repos`: backfill and daily catch-up without an app",
    },
  ],
  settings: SETTINGS_DOC,
  endpoints: { webhook: "" },
  identityNamespace: () => "github",
  receive(req, keys) {
    const secret = keys.secrets.webhookSecret;
    const signature = req.headers.get("x-hub-signature-256");
    if (
      !secret ||
      !signature ||
      !safeEqual(signature, `sha256=${hmacHex(secret, req.rawBody)}`)
    ) {
      return { type: "reject", status: 401, error: "bad signature" };
    }
    const eventType = req.headers.get("x-github-event") ?? "unknown";
    if (eventType === "ping") {
      return { type: "respond", body: { ok: true } };
    }
    const payload = parse(req.rawBody);
    if (!payload) {
      return { type: "reject", status: 400, error: "body is not JSON" };
    }
    return {
      type: "event",
      eventType,
      deliveryId:
        req.headers.get("x-github-delivery") ?? shortHash(req.rawBody),
      payload,
      partition: partitionOf(parsePayload(payload)),
    };
  },
  normalize: (input, conn) => normalize("github", input, conn.settings),
  app: githubApp,
  sync: githubSync,
  sources: {
    list: githubRepos,
    settings: (chosen) => ({ repos: chosen.map((r) => r.id) }),
  },
};

function hostOf(conn: ConnectionView) {
  const { baseUrl } = conn.settings;
  try {
    return new URL(typeof baseUrl === "string" ? baseUrl : "").host;
  } catch {
    return conn.id;
  }
}

export const giteaConnector: Connector = {
  id: "gitea",
  name: "Gitea / Forgejo (self-hosted)",
  description:
    "For self-hosted Gitea or Forgejo. GitHub-compatible webhooks, mapped with the same rules as GitHub.",
  secrets: [
    {
      key: "webhookSecret",
      required: true,
      generated: true,
      description:
        "The webhook's secret. With a `token`, Worklog creates the hooks and their secret itself",
    },
    {
      key: "token",
      required: false,
      description:
        "A token for a bot user who administers `repos`: Worklog creates their webhooks, backfills and catches up daily",
    },
  ],
  settings: [
    {
      key: "baseUrl",
      description:
        "Your server, e.g. https://git.example.com (namespaces identities and links)",
    },
    ...SETTINGS_DOC,
  ],
  endpoints: { webhook: "" },
  identityNamespace: (conn) => `gitea:${hostOf(conn)}`,
  receive(req, keys) {
    const secret = keys.secrets.webhookSecret;
    const signature =
      req.headers.get("x-forgejo-signature") ??
      req.headers.get("x-gitea-signature");
    if (
      !secret ||
      !signature ||
      !safeEqual(signature, hmacHex(secret, req.rawBody))
    ) {
      return { type: "reject", status: 401, error: "bad signature" };
    }
    const eventType =
      req.headers.get("x-forgejo-event") ??
      req.headers.get("x-gitea-event") ??
      "unknown";
    const deliveryId =
      req.headers.get("x-forgejo-delivery") ??
      req.headers.get("x-gitea-delivery") ??
      shortHash(req.rawBody);
    const payload = parse(req.rawBody);
    if (!payload) {
      return { type: "reject", status: 400, error: "body is not JSON" };
    }
    return {
      type: "event",
      eventType,
      deliveryId,
      payload,
      partition: partitionOf(parsePayload(payload)),
    };
  },
  normalize: (input, conn) =>
    normalize(`gitea:${hostOf(conn)}`, input, conn.settings),
  sync: giteaSync,
  hooks: giteaHooks,
};
