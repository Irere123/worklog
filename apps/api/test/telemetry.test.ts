import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { complete } from "#agent/generate";
import { createApp } from "#app";
import { enqueue } from "#jobs/queue";
import { conflict } from "#lib/errors";
import { describeError, fingerprint } from "#telemetry/describe";
import { tracedFetch } from "#telemetry/instrument";
import { log } from "#telemetry/log";
import { flush, sinkHealth } from "#telemetry/sink";
import { startTelemetry } from "#telemetry/start";
import { traced } from "#telemetry/trace";

import { scriptedModel, testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
let stop: (() => Promise<void>) | null = null;

beforeAll(async () => {
  env = await testEnv();
  // Registered before the app answers anything: Hono builds its router on the first request.
  env.app.get("/v1/test/boom", () => {
    throw new Error("kaboom for emma@example.com");
  });
});

afterEach(async () => {
  await stop?.();
  stop = startTelemetry(env.ctx.config, {
    service: "test",
    pool: env.ctx.pool,
    fetch: env.ctx.fetch,
  });
  await stop();
  stop = null;
});

type Row = Record<string, any>;

// Tinybird's Events API as the exporter sees it: gzipped NDJSON, one datasource per request.
function tinybird(
  opts: {
    sampleRate?: number;
    // How Tinybird answers each request, in turn; it accepts once these run out.
    answers?: (() => Promise<number | Response>)[];
  } = {}
) {
  const answers = [...(opts.answers ?? [])];
  const rows = { spans: [] as Row[], logs: [] as Row[], metrics: [] as Row[] };
  const requests: { url: URL; headers: Headers }[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
    const name = url.searchParams.get("name") ?? "";
    requests.push({ url, headers: new Headers(init?.headers) });
    const status = await (
      answers.shift() ?? (async () => await Promise.resolve(202))
    )();
    if (status instanceof Response) {
      return status;
    }
    if (status !== 202) {
      return new Response("no", { status });
    }
    for (const line of gunzipSync(body).toString().split("\n")) {
      if (line) {
        (rows as Record<string, Row[] | undefined>)[name]?.push(
          JSON.parse(line)
        );
      }
    }
    return Response.json(
      { successful_rows: 1, quarantined_rows: 0 },
      {
        status: 202,
      }
    );
  }) as typeof fetch;
  stop = startTelemetry(
    {
      ...env.ctx.config,
      TINYBIRD_TOKEN: "p.test",
      TINYBIRD_HOST: "https://api.tinybird.test",
      TELEMETRY_SAMPLE_RATE: opts.sampleRate ?? 1,
      TELEMETRY_SLOW_MS: 60_000,
      WORKLOG_RELEASE: "abc123",
    },
    { service: "test", pool: env.ctx.pool, fetch: fake }
  );
  return { rows, requests };
}

async function request(target: string, headers: Record<string, string> = {}) {
  return await env.app.request(target, { headers });
}

describe("telemetry", () => {
  test("every API response names its trace", async () => {
    const res = await request("/v1/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("x-worklog-trace")).toMatch(/^[0-9a-f]{32}$/u);
  });

  test("a request is a span named by its route, with its workspace and the queries it ran", async () => {
    const sent = tinybird();
    const { token, workspace, member } = await env.workspace("Spans Co");
    const res = await request(`/v1/members/${member.id}`, {
      authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    await flush();

    const traceId = res.headers.get("x-worklog-trace");
    const span = sent.rows.spans.find((s) => s.trace_id === traceId);
    expect(span).toMatchObject({
      name: "GET /v1/members/:ref",
      kind: "server",
      status: "ok",
      parent_id: "",
      workspace_id: workspace.id,
      service: "test",
      release: "abc123",
    });
    expect(span?.db_queries).toBeGreaterThan(0);
    expect(JSON.parse(span?.attributes)).toMatchObject({
      "http.route": "/v1/members/:ref",
      "http.status_code": 200,
      "member.id": member.id,
    });

    // Queries inside a transaction count toward the request too.
    const setup = sent.rows.spans.find((s) => s.name === "POST /v1/setup");
    const tx = sent.rows.spans.find(
      (s) => s.name === "db.transaction" && s.parent_id === setup?.span_id
    );
    expect(tx?.db_queries).toBeGreaterThan(0);
    expect(setup?.db_queries).toBeGreaterThan(tx?.db_queries);

    const [first] = sent.requests;
    expect(first?.url.pathname).toBe("/v0/events");
    expect(first?.headers.get("authorization")).toBe("Bearer p.test");
    expect(first?.headers.get("content-encoding")).toBe("gzip");
  });

  test("with the web app served alongside, a request is still named by its own route", async () => {
    const sent = tinybird();
    const dist = mkdtempSync(path.join(tmpdir(), "worklog-web-"));
    writeFileSync(path.join(dist, "_shell.html"), "<!doctype html>");
    const app = createApp({
      ...env.ctx,
      config: { ...env.ctx.config, WEB_DIST: dist },
    });
    const { token, member } = await env.workspace("Web Spans Co");
    const found = await app.request(`/v1/members/${member.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const missing = await app.request("/v1/no-such-thing", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.status).toBe(404);
    await flush();

    const named = (res: Response) =>
      sent.rows.spans.find(
        (s) => s.trace_id === res.headers.get("x-worklog-trace")
      )?.name;
    expect(named(found)).toBe("GET /v1/members/:ref");
    expect(named(missing)).toBe("GET unmatched");
  });

  test("a response the API didn't build, like Better Auth's, still names its trace", async () => {
    const res = await request("/api/auth/ok");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-worklog-trace")).toMatch(/^[0-9a-f]{32}$/u);
  });

  test("a browser's preflight isn't counted as a request", async () => {
    const sent = tinybird();
    const res = await env.app.request("/v1/me", {
      method: "OPTIONS",
      headers: {
        origin: "https://elsewhere.example",
        "access-control-request-method": "GET",
      },
    });
    expect(res.status).toBe(204);
    await flush();
    expect(
      sent.rows.spans.some((s) => String(s.name).startsWith("OPTIONS"))
    ).toBe(false);
  });

  test("a refusal the caller caused is recorded on its span without failing it", async () => {
    const sent = tinybird({ sampleRate: 0 });
    await traced("test: refused", {}, async () => {
      await Promise.resolve();
      throw conflict("That name is taken");
    }).catch(() => null);
    await flush();
    // Sampled out and not a fault, so nothing about it is kept.
    expect(sent.rows.spans.some((s) => s.name === "test: refused")).toBe(false);

    const kept = tinybird();
    await traced("test: refused", {}, async () => {
      await Promise.resolve();
      throw conflict("That name is taken");
    }).catch(() => null);
    await flush();
    expect(
      kept.rows.spans.find((s) => s.name === "test: refused")
    ).toMatchObject({ status: "ok", error_code: "conflict" });
  });

  test("a kept span says how many it stands for, so counts survive sampling", async () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- pins the sampling roll, which is otherwise random
    const random = spyOn(Math, "random").mockReturnValue(0.1);
    try {
      const sent = tinybird({ sampleRate: 0.25 });
      await traced("test: sampled", {}, async () => {
        await Promise.resolve();
      });
      await traced("test: broken", {}, async () => {
        await Promise.resolve();
        throw new Error("broken");
      }).catch(() => null);
      await flush();
      const weight = (name: string) =>
        sent.rows.spans.find((s) => s.name === name)?.weight;
      expect(weight("test: sampled")).toBe(4);
      // Every failed trace is kept, so each stands for one.
      expect(weight("test: broken")).toBe(1);
    } finally {
      random.mockRestore();
    }
  });

  test("a request continues the trace its caller sent", async () => {
    const sent = tinybird();
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const res = await request("/v1/me", {
      traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
    });
    expect(res.headers.get("x-worklog-trace")).toBe(traceId);
    await flush();
    expect(sent.rows.spans.find((s) => s.trace_id === traceId)).toMatchObject({
      parent_id: "00f067aa0ba902b7",
    });
  });

  test("an unhandled error fails its span and is logged as an issue, with nothing personal in it", async () => {
    const sent = tinybird();
    const { token } = await env.workspace("Errors Co");
    const res = await request("/v1/test/boom", {
      authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(500);
    await flush();

    const traceId = res.headers.get("x-worklog-trace");
    expect(sent.rows.spans.find((s) => s.trace_id === traceId)).toMatchObject({
      name: "GET /v1/test/boom",
      status: "error",
      error_type: "Error",
      error_message: "kaboom for [email]",
    });
    const logged = sent.rows.logs.find((l) => l.trace_id === traceId);
    expect(logged).toMatchObject({
      level: "error",
      message: "api: unhandled error",
      error_message: "kaboom for [email]",
    });
    expect(logged?.fingerprint).toMatch(/^[0-9a-f]{16}$/u);
    expect(logged?.error_stack).toContain("telemetry.test.ts");
    expect(JSON.stringify(sent.rows)).not.toContain("emma@example.com");
  });

  test("an unsampled trace is dropped, unless something in it failed", async () => {
    const sent = tinybird({ sampleRate: 0 });
    const { token } = await env.workspace("Sampled Co");
    const fine = await request("/v1/me", { authorization: `Bearer ${token}` });
    const broken = await request("/v1/test/boom", {
      authorization: `Bearer ${token}`,
    });
    await flush();

    const traces = new Set(sent.rows.spans.map((s) => s.trace_id));
    expect(traces.has(fine.headers.get("x-worklog-trace"))).toBe(false);
    expect(traces.has(broken.headers.get("x-worklog-trace"))).toBe(true);
  });

  test("a job run is the root of its own trace", async () => {
    const sent = tinybird();
    await enqueue(env.ctx, "events:prune", {});
    await env.drain();
    await flush();

    const job = sent.rows.spans.find((s) => s.name === "job events:prune");
    expect(job).toMatchObject({
      kind: "consumer",
      status: "ok",
      parent_id: "",
    });
    expect(JSON.parse(job?.attributes)).toMatchObject({
      "job.task": "events:prune",
      "job.attempt": 1,
    });
  });

  test("a call out of the process is a span with its host, never its path", async () => {
    const sent = tinybird();
    const slack = (async () =>
      await Promise.resolve(new Response("ok"))) as unknown as typeof fetch;
    await traced("test", {}, async () => {
      await tracedFetch(slack)(
        "https://hooks.example.com/services/T000/B000/s3cr3t?token=x",
        { method: "POST" }
      );
    });
    await flush();
    expect(
      sent.rows.spans.find((s) => s.name === "POST hooks.example.com")
    ).toMatchObject({ kind: "client", status: "ok" });
    expect(JSON.stringify(sent.rows)).not.toContain("s3cr3t");
  });

  test("a model call is a span with its model and tokens, and no prompt or answer", async () => {
    const sent = tinybird();
    const { model } = scriptedModel([{ text: "The answer is forty-two" }]);
    await traced("test", {}, async () => {
      await complete(
        { main: model, fast: model },
        {
          model: "fast",
          instructions: "Be brief",
          prompt: "What is the meaning of life?",
          timeout: "quick",
        }
      );
    });
    await flush();

    const call = sent.rows.spans.find((s) => s.name === "ai.model_call");
    expect(call).toMatchObject({ kind: "client", status: "ok" });
    expect(JSON.parse(call?.attributes)["ai.tokens.input"]).toBeGreaterThan(0);
    const operation = sent.rows.spans.find(
      (s) => s.span_id === call?.parent_id
    );
    expect(operation?.name).toBe("ai.generateText");
    const text = JSON.stringify(sent.rows);
    expect(text).not.toContain("meaning of life");
    expect(text).not.toContain("forty-two");
  });

  test("log lines carry the trace they were written in", async () => {
    const sent = tinybird();
    log.info("test: no trace here", { count: 3 });
    await flush();
    expect(sent.rows.logs.at(-1)).toMatchObject({
      level: "info",
      message: "test: no trace here",
      trace_id: "",
      fingerprint: "",
    });
    expect(JSON.parse(sent.rows.logs.at(-1)?.attributes)).toEqual({
      count: 3,
    });
  });
});

describe("when Tinybird can't take rows", () => {
  test("rows it can't take right now are sent again with the next flush", async () => {
    const sent = tinybird({
      answers: [async () => await Promise.resolve(503)],
    });
    log.info("test: kept through an outage");
    await flush();
    expect(sent.rows.logs).toHaveLength(0);
    await flush();
    expect(
      sent.rows.logs.filter((l) => l.message === "test: kept through an outage")
    ).toHaveLength(1);
  });

  test("rows it can't be reached for are kept too", async () => {
    const sent = tinybird({
      answers: [
        async () => {
          await Promise.resolve();
          throw new TypeError("fetch failed");
        },
      ],
    });
    log.info("test: kept while unreachable");
    await flush();
    await flush();
    expect(
      sent.rows.logs.filter((l) => l.message === "test: kept while unreachable")
    ).toHaveLength(1);
  });

  test("rows it refuses are dropped rather than sent forever", async () => {
    const sent = tinybird({
      answers: [async () => await Promise.resolve(400)],
    });
    log.info("test: refused");
    await flush();
    log.info("test: accepted");
    await flush();
    expect(sent.rows.logs.map((l) => l.message)).toEqual(["test: accepted"]);
  });

  test("flushes asked for while one hangs share one send after it", async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<null>();
    const sent = tinybird({
      answers: [
        async () => {
          await gate;
          return 202;
        },
      ],
    });
    log.info("test: first");
    const first = flush();
    log.info("test: second");
    const waiting = Array.from({ length: 50 }, async () => {
      await flush();
    });
    release(null);
    await Promise.all([first, ...waiting]);
    expect(sent.requests).toHaveLength(2);
    expect(sent.rows.logs.map((l) => l.message)).toEqual([
      "test: first",
      "test: second",
    ]);
  });

  test("rows Tinybird quarantines are counted, not taken as stored", async () => {
    tinybird({
      answers: [
        async () =>
          await Promise.resolve(
            Response.json(
              { successful_rows: 0, quarantined_rows: 1 },
              { status: 202 }
            )
          ),
      ],
    });
    const before = sinkHealth().quarantined;
    log.info("test: quarantined");
    await flush();
    expect(sinkHealth().quarantined).toBe(before + 1);
  });

  test("a field that won't serialize is written as text, never thrown", async () => {
    const sent = tinybird();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => {
      log.warn("test: odd fields", { cycle, big: 10n });
    }).not.toThrow();
    await flush();
    expect(JSON.parse(sent.rows.logs.at(-1)?.attributes)).toEqual({
      cycle: "[object Object]",
      big: "10",
    });
  });
});

describe("error grouping", () => {
  test("occurrences differing only in ids and numbers are one issue", () => {
    const a = describeError(
      new Error(
        'Card 2Hk3pQ9xYzA1bC4dE5fG6hI7jK8 not found after 3 tries in "x"'
      )
    );
    const b = describeError(
      new Error(
        'Card 9Zz8yY7xX6wW5vV4uU3tT2sS1rR not found after 12 tries in "y"'
      )
    );
    expect(fingerprint("ingest: delivery failed", a)).toBe(
      fingerprint("ingest: delivery failed", b)
    );
    expect(fingerprint("ingest: delivery failed", a)).not.toBe(
      fingerprint("ingest: replay failed", a)
    );
  });

  test("what a database error says about a key reads as it was", () => {
    const { message } = describeError(
      new Error('duplicate key value violates unique constraint "cards_pkey"')
    );
    expect(message).toBe(
      'duplicate key value violates unique constraint "cards_pkey"'
    );
  });

  test("an error carries the code a program can act on, from the driver's error under it", () => {
    const deadlock = Object.assign(new Error("deadlock detected"), {
      code: "40P01",
    });
    const wrapped = new Error("Failed query: update cards", {
      cause: deadlock,
    });
    expect(describeError(wrapped)).toMatchObject({
      code: "40P01",
      message:
        "Failed query: update cards ← caused by Error: deadlock detected",
    });
  });

  test("a failed query's parameters never leave, only its SQL and why it failed", () => {
    const cause = Object.assign(new Error("deadlock detected"), {
      code: "40P01",
    });
    const failed = Object.assign(
      new Error(
        "Failed query: insert into activities (title) values ($1)\nparams: Ana's salary review notes"
      ),
      {
        query: "insert into activities (title) values ($1)",
        params: ["Ana's salary review notes"],
        cause,
      }
    );
    const described = describeError(failed);
    expect(described.message).toBe(
      "Failed query: insert into activities (title) values ($1) ← caused by Error: deadlock detected"
    );
    expect(described.code).toBe("40P01");
    expect(JSON.stringify(described)).not.toContain("salary");
  });

  test("what a model wrote never leaves inside the error about it", () => {
    const parse = Object.assign(
      new Error(
        "JSON parsing failed: Text: Logged it privately: interview at Acme."
      ),
      { name: "AI_JSONParseError" }
    );
    const outer = Object.assign(
      new Error("No object generated: could not parse the response.", {
        cause: parse,
      }),
      { name: "AI_NoObjectGeneratedError" }
    );
    const described = describeError(outer);
    expect(described.message).toBe("caused by AI_JSONParseError");
    expect(JSON.stringify(described)).not.toContain("interview");
  });

  test("an error from inside a library is placed at the first frame of ours that awaited it", () => {
    const error = new Error("connection terminated");
    error.stack = [
      "Error: connection terminated",
      "    at Client._handleErrorEvent (/app/node_modules/pg/lib/client.js:12:3)",
      "    at async insertCard (/app/apps/api/src/db/queries/cards.ts:40:7)",
      "    at async createCard (/app/apps/api/src/work/board.ts:88:3)",
    ].join("\n");
    expect(describeError(error).frame).toBe("insertCard db/queries/cards.ts");
  });

  test("different constraints are different issues; different ids are the same one", () => {
    expect(
      issue('duplicate key value violates unique constraint "cards_pkey"')
    ).not.toBe(
      issue(
        'duplicate key value violates unique constraint "members_email_key"'
      )
    );
    expect(issue("channel C024BE91L not found")).toBe(
      issue("channel C07QX2M3NBZ not found")
    );
    expect(
      issue("commit 9fceb02d0ae598e95dc970b74767f19372d61af8 missing")
    ).toBe(issue("commit 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b missing"));
  });

  test("a provider's refusals group by status, not by what it echoed back", () => {
    expect(refusal('{"message":"Validation Failed","field":"title"}')).toBe(
      refusal('{"message":"Validation Failed","field":"body"}')
    );
  });

  test("credentials and addresses are masked", () => {
    const { message } = describeError(
      new Error(
        "rejected wl_abc123 for ana@example.org with Bearer xyz, api_key=k1 and password: hunter2"
      )
    );
    expect(message).toBe(
      "rejected [token] for [email] with Bearer [redacted], api_key=[redacted] and password: [redacted]"
    );
  });
});

function issue(message: string) {
  return fingerprint(
    "ingest: delivery failed",
    describeError(new Error(message))
  );
}

function refusal(body: string) {
  return fingerprint(
    "sync: failed",
    describeError(
      Object.assign(new Error(`GitHub issues: 422 ${body}`), {
        name: "ProviderError",
        kind: "failed",
      })
    )
  );
}
