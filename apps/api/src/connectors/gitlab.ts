import type { Connector } from "#connectors/types";
import { safeEqual, shortHash } from "#lib/crypto";

import { gitlabHooks, hostOf, listGitlabProjects } from "./gitlab/api";
import { normalizeGitlab, parseGitlab } from "./gitlab/events";
import { gitlabSync, normalizeGitlabPage } from "./gitlab/sync";

function parse(rawBody: string): object | null {
  try {
    const value: unknown = JSON.parse(rawBody);
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return null;
  }
}

function partitionOf(payload: object) {
  const p = parseGitlab(payload);
  return p.project?.id === undefined
    ? (p.project?.path_with_namespace ?? "")
    : String(p.project.id);
}

const ns = (conn: Parameters<Connector["identityNamespace"]>[0]) =>
  `gitlab:${hostOf(conn)}`;

export const gitlabConnector: Connector = {
  id: "gitlab",
  name: "GitLab",
  description:
    "GitLab.com or self-managed: merge requests, reviews and approvals, issues, comments, pushes and releases. Review requests, assignments and @mentions become attention items; issues can become cards.",
  secrets: [
    {
      key: "webhookSecret",
      required: true,
      generated: true,
      description:
        "The webhook's secret token. With a `token`, Worklog creates the webhooks and their secret itself",
    },
    {
      key: "token",
      required: false,
      description:
        "An access token with `api` scope, for a user or bot who maintains `repos`: Worklog creates their webhooks, backfills and catches up daily",
    },
  ],
  settings: [
    {
      key: "baseUrl",
      description:
        "Your GitLab, e.g. https://gitlab.example.com (default https://gitlab.com; namespaces identities and links)",
    },
    {
      key: "boardId",
      description: "Board where new issues land as cards in Maybe? (optional)",
    },
    {
      key: "repos",
      description:
        'Only these projects, e.g. ["acme/api", "acme/platform/web"] (optional with webhooks; needed for a token to manage hooks and backfill)',
    },
    {
      key: "bots",
      description:
        '"quiet" (default: keep only bot merge requests/releases), "drop", or "keep"',
    },
    {
      key: "ignoreKinds",
      description: 'Event kinds to never record, e.g. ["code.pushed"]',
    },
  ],
  endpoints: { webhook: "" },
  identityNamespace: ns,
  receive(req, keys) {
    const secret = keys.secrets.webhookSecret;
    const token = req.headers.get("x-gitlab-token");
    if (!secret || !token || !safeEqual(token, secret)) {
      return { type: "reject", status: 401, error: "bad token" };
    }
    const payload = parse(req.rawBody);
    if (!payload) {
      return { type: "reject", status: 400, error: "body is not JSON" };
    }
    const kind = parseGitlab(payload).object_kind;
    return {
      type: "event",
      eventType: kind ?? req.headers.get("x-gitlab-event") ?? "unknown",
      deliveryId:
        req.headers.get("idempotency-key") ??
        req.headers.get("x-gitlab-event-uuid") ??
        shortHash(req.rawBody),
      payload,
      partition: partitionOf(payload),
    };
  },
  normalize: (input, conn) =>
    input.eventType === "sync.gitlab"
      ? normalizeGitlabPage(
          ns(conn),
          input.payload,
          input.receivedAt,
          conn.settings
        )
      : normalizeGitlab(
          ns(conn),
          input.eventType,
          input.payload,
          input.receivedAt,
          conn.settings
        ),
  hooks: gitlabHooks,
  sync: gitlabSync,
  sources: {
    list: async (ctx, conn) => await listGitlabProjects(ctx, conn),
    settings: (chosen) => ({ repos: chosen.map((p) => p.id) }),
  },
};
