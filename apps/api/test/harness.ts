import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Client } from "pg";

import { createApp } from "#app";
import { loadConfig } from "#config";
import { createContext } from "#context";
import type { AppContext } from "#context";
import { runJobsOnce } from "#jobs/tasks";
import { ConsoleMailer } from "#lib/mailer";

export { hmacHex } from "#lib/crypto";
export { DAY_MS } from "#lib/time";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/worklog_test";
let shared: Promise<AppContext> | null = null;

export type TestEnv = Awaited<ReturnType<typeof testEnv>>;

export async function testEnv() {
  shared ??= openTestContext();
  const ctx = await shared;
  const reset = () => {
    ctx.models = null;
    ctx.now = () => new Date();
    ctx.fetch = fetchStub();
    (ctx.mailer as ConsoleMailer).sent.length = 0;
  };
  reset();
  const app = createApp(ctx);

  async function call(
    method: string,
    path: string,
    opts: {
      token?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ) {
    const res = await app.request(path, {
      method,
      headers: {
        ...(opts.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  async function workspace(
    name = "Acme",
    owner: { name?: string; email?: string; timezone?: string } = {}
  ) {
    const res = await call("POST", "/v1/setup", {
      headers: { "x-setup-secret": "test-secret" },
      body: {
        workspaceName: name,
        name: owner.name ?? "Emma",
        email: owner.email ?? "emma@example.com",
        timezone: owner.timezone ?? "Africa/Kigali",
      },
    });
    if (res.status !== 201) {
      throw new Error(`setup failed: ${JSON.stringify(res.body)}`);
    }
    return {
      token: res.body.token.token as string,
      member: res.body.member,
      assistant: res.body.assistant,
      workspace: res.body.workspace,
    };
  }

  async function teammate(
    ownerToken: string,
    name: string,
    extra: Record<string, unknown> = {}
  ) {
    const res = await call("POST", "/v1/members", {
      token: ownerToken,
      body: { kind: "human", name, issueToken: true, ...extra },
    });
    if (res.status !== 201) {
      throw new Error(`teammate failed: ${JSON.stringify(res.body)}`);
    }
    return { token: res.body.token.token as string, member: res.body.member };
  }

  const drain = async (opts: { later?: string } = {}) => {
    if (opts.later !== undefined) {
      await ctx.pool.query(
        "update graphile_worker._private_jobs set run_at = now() where run_at > now() and locked_at is null and payload->>'workspaceId' = $1",
        [opts.later]
      );
    }
    await runJobsOnce(ctx);
    await ctx.tally.flush();
  };

  return { ctx, app, call, workspace, teammate, reset, drain };
}

export async function freshDatabase(name: string) {
  const server = new URL(TEST_DATABASE_URL);
  server.pathname = "/postgres";
  const admin = new Client({ connectionString: server.href });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.href;
}

async function openTestContext() {
  return await createContext(
    loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: await freshDatabase(
        new URL(TEST_DATABASE_URL).pathname.slice(1)
      ),
      SETUP_SECRET: "test-secret",
      PUBLIC_URL: "https://worklog.test",
    }),
    { models: null, mailer: new ConsoleMailer() }
  );
}

function urlOf(input: string | URL | Request) {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

export function fetchStub() {
  const calls: { url: string; init?: RequestInit; body: any }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body ?? null;
    const body =
      raw === null ? undefined : JSON.parse(await new Response(raw).text());
    calls.push({ url: urlOf(input), init, body });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

type Routed = {
  url: string;
  method: string;
  headers: Headers;
  body: any;
};

/**
 * A provider API scripted per test: "POST https://api.github.com/app/installations" matches by
 * method and URL prefix, first match wins, and a plain value is sent as JSON. Anything unmatched
 * answers `{ ok: true }`. Every call is recorded in `calls`.
 */
export function routedFetch(
  routes: [string, (req: Routed) => unknown][]
): typeof fetch & { calls: Routed[] } {
  const calls: Routed[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw =
      init?.body === undefined || init.body === null
        ? ""
        : await new Response(init.body).text();
    let body: any = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = Object.fromEntries(new URLSearchParams(raw));
    }
    const req = {
      url: urlOf(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body,
    };
    calls.push(req);
    for (const [pattern, handle] of routes) {
      const [method, prefix = ""] = pattern.split(" ");
      if (method === req.method && req.url.startsWith(prefix)) {
        const out = await handle(req);
        return out instanceof Response ? out : Response.json(out);
      }
    }
    return Response.json({ ok: true });
  }) as unknown as typeof fetch & { calls: Routed[] };
  fn.calls = calls;
  return fn;
}

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

type Step =
  | { text: string; until?: Promise<unknown>; cacheRead?: number }
  | { tool: string; input: unknown };

export function scriptedModel(steps: Step[]) {
  const prompts: any[] = [];
  let i = 0;
  const nextStep = (options: unknown) => {
    prompts.push(options);
    const step = steps[Math.min(i, steps.length - 1)]!;
    i += 1;
    return step;
  };
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const step = nextStep(options);
      if ("until" in step && step.until) {
        const held = { settled: false };
        void step.until.then(() => {
          held.settled = true;
          return held;
        });
        while (!held.settled) {
          if (options.abortSignal?.aborted === true) {
            throw new DOMException("The turn was stopped", "AbortError");
          }
          await Bun.sleep(5);
        }
      }
      if ("tool" in step) {
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `call_${i}`,
              toolName: step.tool,
              input: JSON.stringify(step.input),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text", text: step.text }],
        finishReason: { unified: "stop", raw: undefined },
        usage:
          step.cacheRead === undefined
            ? usage
            : {
                ...usage,
                inputTokens: {
                  ...usage.inputTokens,
                  cacheRead: step.cacheRead,
                },
              },
        warnings: [],
      };
    },
    // oxlint-disable-next-line require-await -- fulfils the async LanguageModel contract; scripted steps are synchronous
    doStream: async (options) => {
      const step = nextStep(options);
      const body =
        "tool" in step
          ? [
              {
                type: "tool-call" as const,
                toolCallId: `call_${i}`,
                toolName: step.tool,
                input: JSON.stringify(step.input),
              },
            ]
          : [
              { type: "text-start" as const, id: "t" },
              { type: "text-delta" as const, id: "t", delta: step.text },
              { type: "text-end" as const, id: "t" },
            ];
      const finishReason = {
        unified: "tool" in step ? ("tool-calls" as const) : ("stop" as const),
        raw: undefined,
      };
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            ...body,
            { type: "finish" as const, finishReason, usage },
          ],
        }),
      };
    },
  });
  return { model, prompts };
}
