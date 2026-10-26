import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createContext } from "../src/context";
import type { AppContext } from "../src/context";
import { ConsoleMailer } from "../src/delivery/mailer";
import { drainQueue } from "../src/jobs/queue";
import "../src/ingest/pipeline";

/**
 * One embedded Postgres for the whole test run (PGlite boots slowly; bun runs every test file in
 * one process). Isolation comes from every test creating its own workspace — all data is tenant-scoped.
 */
let shared: Promise<AppContext> | null = null;

export type TestEnv = Awaited<ReturnType<typeof testEnv>>;

export async function testEnv() {
  shared ??= createContext(
    loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "memory://",
      SETUP_SECRET: "test-secret",
      PUBLIC_URL: "http://worklog.test",
    }),
    { models: null, mailer: new ConsoleMailer() }
  );
  const ctx = await shared;
  /** Per-test knobs (clock, model, outbound HTTP, mail); call from beforeEach. */
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

  /** A fresh workspace with an owner (email set) and a token. */
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

  /** Adds a human teammate and returns their token. */
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

  /** Process queued ingestion jobs (the scheduler does this continuously in a real server). */
  const drain = async () => await drainQueue(ctx);

  return { ctx, app, call, workspace, teammate, reset, drain };
}

function urlOf(input: string | URL | Request) {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/** Records outbound HTTP (Slack, Discord, webhooks) and answers like the real APIs would. */
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

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

type Step = { text: string } | { tool: string; input: unknown };

/**
 * A scripted model: each call returns the next step (a tool call or a final text).
 * `prompts` records what the model was sent, including which tools it was offered.
 */
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
    // oxlint-disable-next-line require-await -- fulfils the async LanguageModel contract; scripted steps are synchronous
    doGenerate: async (options) => {
      const step = nextStep(options);
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
        usage,
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
