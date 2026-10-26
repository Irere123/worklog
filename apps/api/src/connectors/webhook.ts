import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import type { Connector, ExternalActor, WorklogEvent } from "../ingest/types";
import { safeEqual } from "../lib/crypto";

/**
 * A no-code connector for any tool that sends webhooks (self-hosted GitLab, Sentry, Jenkins, an
 * internal deploy bot…). The connection's settings say how to verify a delivery and how to map it:
 *
 *   {
 *     "verify":     { "type": "hmac-sha256", "header": "X-Signature", "prefix": "sha256=" },   // or { "type": "token", "header": "X-Gitlab-Token" }
 *     "eventType":  { "header": "X-Gitlab-Event" },                                             // or { "path": "object_kind" }
 *     "deliveryId": { "header": "X-Gitlab-Event-UUID" },                                        // default: hash of the body
 *     "rules": [{
 *       "when": { "eventType": "Merge Request Hook", "equals": { "object_attributes.action": "merge" } },
 *       "emit": {
 *         "kind": "pr.merged", "id": "mr:{{project.path_with_namespace}}!{{object_attributes.iid}}:merged",
 *         "title": "Merged MR {{project.path_with_namespace}}!{{object_attributes.iid}}: {{object_attributes.title}}",
 *         "url": "{{object_attributes.url}}", "thread": "mr:{{project.path_with_namespace}}!{{object_attributes.iid}}",
 *         "actor": { "id": "{{user.id}}", "handle": "{{user.username}}", "name": "{{user.name}}" }
 *       }
 *     }]
 *   }
 *
 * Templates only read values (`{{a.b.0.c}}`) — no expressions, nothing executes. Unsigned webhooks are
 * refused unless the connection explicitly allows them.
 */

const Template = z.string().max(500);
const Rule = z.object({
  when: z
    .object({
      eventType: z.union([z.string(), z.array(z.string())]).optional(),
      equals: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      exists: z.array(z.string()).optional(),
    })
    .optional(),
  emit: z.object({
    kind: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, "kinds look like noun.verb, e.g. deploy.finished"),
    id: Template,
    title: Template,
    body: Template.optional(),
    url: Template.optional(),
    thread: Template.optional(),
    occurredAt: Template.optional(),
    actor: z.object({ id: Template, handle: Template.optional(), name: Template.optional(), bot: z.boolean().optional() }).optional(),
    importance: z.number().min(0).max(1).optional(),
    mention: Template.optional().describe("A handle to raise a mention for"),
    reviewer: Template.optional().describe("A handle whose review is requested"),
  }),
});

export const WebhookSettings = z.object({
  verify: z.discriminatedUnion("type", [
    z.object({ type: z.literal("hmac-sha256"), header: z.string(), prefix: z.string().optional(), encoding: z.enum(["hex", "base64"]).optional() }),
    z.object({ type: z.literal("token"), header: z.string() }),
    /** https://www.standardwebhooks.com — webhook-id / webhook-timestamp / webhook-signature (GitLab 19+, Svix, many SaaS). */
    z.object({ type: z.literal("standard-webhooks"), toleranceSeconds: z.number().int().min(30).max(3600).optional() }),
    z.object({ type: z.literal("none") }),
  ]),
  allowUnsigned: z.boolean().optional(),
  eventType: z.object({ header: z.string().optional(), path: z.string().optional() }).optional(),
  deliveryId: z.object({ header: z.string().optional(), path: z.string().optional() }).optional(),
  identityNamespace: z.string().regex(/^[a-z0-9:._-]+$/).optional(),
  rules: z.array(Rule).min(1).max(50),
});
type Settings = z.infer<typeof WebhookSettings>;

export function readPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function renderTemplate(template: string, data: unknown): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, path: string) => {
    const v = readPath(data, path);
    return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

function matches(rule: z.infer<typeof Rule>, eventType: string, payload: unknown) {
  const w = rule.when;
  if (!w) return true;
  if (w.eventType && !(Array.isArray(w.eventType) ? w.eventType : [w.eventType]).includes(eventType)) return false;
  for (const [path, expected] of Object.entries(w.equals ?? {})) if (readPath(payload, path) !== expected) return false;
  for (const path of w.exists ?? []) if (readPath(payload, path) == null) return false;
  return true;
}

/** Standard Webhooks: base64 HMAC-SHA256 of `${id}.${timestamp}.${body}` with the `whsec_` key; replay window enforced. */
export function verifyStandardWebhook(secret: string, headers: Headers, body: string, now: Date, toleranceSeconds: number) {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigs = headers.get("webhook-signature");
  if (!secret || !id || !ts || !sigs) return false;
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > toleranceSeconds) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return sigs.split(" ").some((s) => s.startsWith("v1,") && safeEqual(s.slice(3), expected));
}

const pick = (src: { header?: string; path?: string } | undefined, headers: Headers, payload: unknown) =>
  src?.header ? headers.get(src.header) : src?.path ? (readPath(payload, src.path) as string | undefined)?.toString() : undefined;

export const webhookConnector: Connector = {
  id: "webhook",
  name: "Custom webhook",
  description: "Map any tool's webhooks to Worklog events with rules — no code. Good for self-hosted GitLab, Sentry, CI, deploy bots.",
  secrets: [{ key: "secret", required: false, description: "Shared secret for HMAC signatures or token headers" }],
  settings: [
    { key: "verify", description: '{ "type": "hmac-sha256", "header": "...", "prefix"?: "sha256=" } | { "type": "token", "header": "..." } | { "type": "none" }' },
    { key: "eventType", description: '{ "header": "X-Event" } or { "path": "object_kind" }' },
    { key: "deliveryId", description: '{ "header": "X-Request-Id" } or { "path": "id" } (default: hash of the body)' },
    { key: "identityNamespace", description: 'Where actors live, e.g. "gitlab:git.example.com" (default: this connection)' },
    { key: "rules", description: "[{ when: { eventType, equals, exists }, emit: { kind, id, title, body, url, thread, actor, importance, mention, reviewer } }]" },
  ],
  endpoints: { webhook: "" },
  identityNamespace: (conn) => (conn.settings.identityNamespace as string | undefined) ?? `webhook:${conn.id}`,
  receive(req, conn) {
    const parsed = WebhookSettings.safeParse(conn.settings);
    if (!parsed.success) return { type: "reject", status: 400, error: "connection is misconfigured" };
    const s: Settings = parsed.data;
    const secret = conn.secrets.secret ?? "";
    if (s.verify.type === "hmac-sha256") {
      const got = req.headers.get(s.verify.header) ?? "";
      const mac = createHmac("sha256", secret).update(req.rawBody).digest(s.verify.encoding ?? "hex");
      if (!secret || !safeEqual(got, `${s.verify.prefix ?? ""}${mac}`)) return { type: "reject", status: 401, error: "bad signature" };
    } else if (s.verify.type === "token") {
      if (!secret || !safeEqual(req.headers.get(s.verify.header) ?? "", secret)) return { type: "reject", status: 401, error: "bad token" };
    } else if (s.verify.type === "standard-webhooks") {
      if (!verifyStandardWebhook(secret, req.headers, req.rawBody, req.receivedAt, s.verify.toleranceSeconds ?? 300)) {
        return { type: "reject", status: 401, error: "bad signature" };
      }
    } else if (!s.allowUnsigned) {
      return { type: "reject", status: 401, error: "unsigned webhooks are disabled for this connection" };
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
      deliveryId: pick(s.deliveryId, req.headers, payload) ?? createHash("sha256").update(req.rawBody).digest("hex").slice(0, 32),
      payload,
    };
  },
  normalize({ eventType, payload, receivedAt }, conn) {
    const s = WebhookSettings.parse(conn.settings);
    const events: WorklogEvent[] = [];
    for (const rule of s.rules) {
      if (!matches(rule, eventType, payload)) continue;
      const e = rule.emit;
      const r = (t?: string) => (t ? renderTemplate(t, payload).trim() || null : null);
      const actor: ExternalActor | null = e.actor && r(e.actor.id) ? { id: r(e.actor.id)!, handle: r(e.actor.handle), name: r(e.actor.name), bot: e.actor.bot } : null;
      const at = r(e.occurredAt);
      const signals = [
        ...(r(e.mention) ? [{ type: "mentioned" as const, who: { id: `handle:${r(e.mention)!.toLowerCase()}`, handle: r(e.mention) } }] : []),
        ...(r(e.reviewer) ? [{ type: "review_requested" as const, who: { id: `handle:${r(e.reviewer)!.toLowerCase()}`, handle: r(e.reviewer) } }] : []),
      ];
      events.push({
        id: r(e.id) ?? `${eventType}:${receivedAt.getTime()}`,
        kind: e.kind,
        occurredAt: at && !Number.isNaN(Date.parse(at)) ? new Date(at) : receivedAt,
        actor,
        title: (r(e.title) ?? e.kind).slice(0, 300),
        body: r(e.body)?.slice(0, 2000) ?? null,
        url: r(e.url),
        thread: r(e.thread),
        importance: e.importance,
        signals,
      });
    }
    return events.length ? { events } : { events: [], ignored: `no rule matched ${eventType}` };
  },
};
