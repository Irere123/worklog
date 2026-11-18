import { createHmac } from "node:crypto";

import { z } from "zod";

import type {
  Connector,
  ExternalActor,
  InboundRequest,
  Signal,
  WorklogEvent,
} from "#connectors/types";
import { safeEqual, shortHash } from "#lib/crypto";

import { chosenNamespace } from "./namespaces";

const Template = z.string().max(500);
const Rule = z.object({
  when: z
    .object({
      eventType: z.union([z.string(), z.array(z.string())]).optional(),
      equals: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
      exists: z.array(z.string()).optional(),
    })
    .optional(),
  emit: z.object({
    kind: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/u,
        "kinds look like noun.verb, e.g. deploy.finished"
      ),
    id: Template,
    title: Template,
    body: Template.optional(),
    url: Template.optional(),
    thread: Template.optional(),
    occurredAt: Template.optional(),
    actor: z
      .object({
        id: Template,
        handle: Template.optional(),
        name: Template.optional(),
        bot: z.boolean().optional(),
      })
      .optional(),
    importance: z.number().min(0).max(1).optional(),
    mention: Template.optional().describe("A handle to raise a mention for"),
    reviewer: Template.optional().describe(
      "A handle whose review is requested"
    ),
  }),
});

export const WebhookSettings = z.object({
  verify: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("hmac-sha256"),
      header: z.string(),
      prefix: z.string().optional(),
      encoding: z.enum(["hex", "base64"]).optional(),
    }),
    z.object({ type: z.literal("token"), header: z.string() }),
    z.object({
      type: z.literal("standard-webhooks"),
      toleranceSeconds: z.number().int().min(30).max(3600).optional(),
    }),
    z.object({ type: z.literal("none") }),
  ]),
  allowUnsigned: z.boolean().optional(),
  eventType: z
    .object({ header: z.string().optional(), path: z.string().optional() })
    .optional(),
  deliveryId: z
    .object({ header: z.string().optional(), path: z.string().optional() })
    .optional(),
  partition: z
    .object({ header: z.string().optional(), path: z.string().optional() })
    .optional(),
  identityNamespace: z
    .string()
    .regex(/^[a-z0-9:._-]+$/u)
    .optional(),
  rules: z.array(Rule).min(1).max(50),
});
type Settings = z.infer<typeof WebhookSettings>;

const isMissing = (v: unknown) => v === null || v === undefined;

export function readPath(data: unknown, path: string) {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    cur =
      typeof cur === "object" && cur !== null
        ? Reflect.get(cur, part)
        : undefined;
  }
  return cur;
}

function scalarText(v: unknown) {
  if (typeof v === "string") {
    return v;
  }
  return typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "bigint"
    ? String(v)
    : undefined;
}

export function renderTemplate(template: string, data: unknown) {
  return template.replaceAll(
    /\{\{\s*(?<path>[\w.-]+)\s*\}\}/gu,
    (_, path: string) => {
      const v = readPath(data, path);
      if (typeof v === "object" && v !== null) {
        return JSON.stringify(v);
      }
      return scalarText(v) ?? "";
    }
  );
}

function matches(
  rule: z.infer<typeof Rule>,
  eventType: string,
  payload: unknown
) {
  const w = rule.when;
  if (!w) {
    return true;
  }
  if (w.eventType !== undefined && w.eventType !== "") {
    const wanted = Array.isArray(w.eventType) ? w.eventType : [w.eventType];
    if (!wanted.includes(eventType)) {
      return false;
    }
  }
  for (const [path, expected] of Object.entries(w.equals ?? {})) {
    if (readPath(payload, path) !== expected) {
      return false;
    }
  }
  return (w.exists ?? []).every((path) => !isMissing(readPath(payload, path)));
}

export function verifyStandardWebhook(
  secret: string,
  headers: Headers,
  body: string,
  now: Date,
  toleranceSeconds: number
) {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigs = headers.get("webhook-signature");
  if (!secret || !id || !ts || !sigs) {
    return false;
  }
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > toleranceSeconds) {
    return false;
  }
  const key = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64"
  );
  const expected = createHmac("sha256", key)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return sigs
    .split(" ")
    .some((s) => s.startsWith("v1,") && safeEqual(s.slice(3), expected));
}

function pick(
  src: { header?: string; path?: string } | undefined,
  headers: Headers,
  payload: unknown
) {
  if (src?.header) {
    return headers.get(src.header);
  }
  return src?.path ? scalarText(readPath(payload, src.path)) : undefined;
}

function verify(s: Settings, secret: string, req: InboundRequest) {
  if (s.verify.type === "hmac-sha256") {
    const got = req.headers.get(s.verify.header) ?? "";
    const mac = createHmac("sha256", secret)
      .update(req.rawBody)
      .digest(s.verify.encoding ?? "hex");
    return secret && safeEqual(got, `${s.verify.prefix ?? ""}${mac}`)
      ? null
      : "bad signature";
  }
  if (s.verify.type === "token") {
    return secret && safeEqual(req.headers.get(s.verify.header) ?? "", secret)
      ? null
      : "bad token";
  }
  if (s.verify.type === "standard-webhooks") {
    return verifyStandardWebhook(
      secret,
      req.headers,
      req.rawBody,
      req.receivedAt,
      s.verify.toleranceSeconds ?? 300
    )
      ? null
      : "bad signature";
  }
  return s.allowUnsigned === true
    ? null
    : "unsigned webhooks are disabled for this connection";
}

const byHandle = (handle: string | null) =>
  handle ? { id: `handle:${handle.toLowerCase()}`, handle } : null;

export const webhookConnector: Connector = {
  id: "webhook",
  perConnection: true,
  name: "Custom webhook",
  description:
    "Map any tool's webhooks to Worklog events with rules — no code. Good for self-hosted GitLab, Sentry, CI, deploy bots.",
  secrets: [
    {
      key: "secret",
      required: false,
      description: "Shared secret for HMAC signatures or token headers",
    },
  ],
  settings: [
    {
      key: "verify",
      description:
        '{ "type": "hmac-sha256", "header": "...", "prefix"?: "sha256=" } | { "type": "token", "header": "..." } | { "type": "none" }',
    },
    {
      key: "eventType",
      description: '{ "header": "X-Event" } or { "path": "object_kind" }',
    },
    {
      key: "deliveryId",
      description:
        '{ "header": "X-Request-Id" } or { "path": "id" } (default: hash of the body)',
    },
    {
      key: "partition",
      description:
        '{ "path": "project.id" }: deliveries with the same value are processed in order, others in parallel (default: all in order)',
    },
    {
      key: "identityNamespace",
      description:
        'Where actors live, e.g. "gitlab:git.example.com" (default: this connection)',
    },
    {
      key: "rules",
      description:
        "[{ when: { eventType, equals, exists }, emit: { kind, id, title, body, url, thread, actor, importance, mention, reviewer } }]",
    },
  ],
  endpoints: { webhook: "" },
  identityNamespace: ({ id, settings }) =>
    chosenNamespace(settings, `webhook:${id}`),
  receive(req, conn) {
    const parsed = WebhookSettings.safeParse(conn.settings);
    if (!parsed.success) {
      return {
        type: "reject",
        status: 400,
        error: "connection is misconfigured",
      };
    }
    const s: Settings = parsed.data;
    const refused = verify(s, conn.secrets.secret ?? "", req);
    if (refused) {
      return { type: "reject", status: 401, error: refused };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody);
    } catch {
      return { type: "reject", status: 400, error: "body must be JSON" };
    }
    return {
      type: "event",
      eventType: pick(s.eventType, req.headers, payload) ?? "event",
      deliveryId:
        pick(s.deliveryId, req.headers, payload) ?? shortHash(req.rawBody),
      payload,
      partition: pick(s.partition, req.headers, payload) ?? "",
    };
  },
  normalize({ eventType, payload, receivedAt }, conn) {
    const s = WebhookSettings.parse(conn.settings);
    const events: WorklogEvent[] = [];
    for (const rule of s.rules) {
      if (!matches(rule, eventType, payload)) {
        continue;
      }
      const e = rule.emit;
      const r = (t?: string) =>
        t ? renderTemplate(t, payload).trim() || null : null;
      const actorId = e.actor ? r(e.actor.id) : null;
      const actor: ExternalActor | null =
        e.actor && actorId
          ? {
              id: actorId,
              handle: r(e.actor.handle),
              name: r(e.actor.name),
              bot: e.actor.bot,
            }
          : null;
      const at = r(e.occurredAt);
      const mentioned = byHandle(r(e.mention));
      const reviewer = byHandle(r(e.reviewer));
      const signals: Signal[] = [
        ...(mentioned ? [{ type: "mentioned" as const, who: mentioned }] : []),
        ...(reviewer
          ? [{ type: "review_requested" as const, who: reviewer }]
          : []),
      ];
      events.push({
        id: r(e.id) ?? `${eventType}:${receivedAt.getTime()}`,
        kind: e.kind,
        occurredAt:
          at && !Number.isNaN(Date.parse(at)) ? new Date(at) : receivedAt,
        actor,
        title: (r(e.title) ?? e.kind).slice(0, 300),
        body: r(e.body)?.slice(0, 2000) ?? null,
        url: r(e.url),
        thread: r(e.thread),
        importance: e.importance,
        signals,
      });
    }
    return events.length
      ? { events }
      : { events: [], ignored: `no rule matched ${eventType}` };
  },
};
