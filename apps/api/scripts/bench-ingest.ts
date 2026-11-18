import { readdirSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { createApp } from "#app";
import { loadConfig } from "#config";
import { createContext } from "#context";
import { startWorker } from "#jobs/tasks";
import { hmacHex } from "#lib/crypto";

const num = (name: string, fallback: number) =>
  Number(process.env[name] ?? fallback);
const TEAMS = num("TEAMS", 10);
const PEOPLE = num("PEOPLE", 5000);
const MEMBERS = num("MEMBERS", 20);
const REPOS = num("REPOS", 40);
const CHANNELS = num("CHANNELS", 20);
const SLACK = num("SLACK", 0.5);
const DELIVERIES = num("DELIVERIES", 4000);
const RATE = num("RATE", 0);
const DURATION = num("DURATION", 60);
const CONCURRENCY = num("CONCURRENCY", 16);
const IN_FLIGHT = num("IN_FLIGHT", 32);
const WORKERS = num("WORKERS", 1);
const APIS = num("APIS", 0);
const KILL_AT = num("KILL_AT", 0);

const config = loadConfig({
  ...process.env,
  OPENROUTER_API_KEY: "",
  DATABASE_POOL_SIZE: APIS > 0 ? "8" : "24",
});
if (!config.SETUP_SECRET) {
  throw new Error("Set SETUP_SECRET: the bench creates workspaces");
}
if (process.argv.includes("--worker")) {
  await work();
}
if (process.argv.includes("--api")) {
  await serveApi();
}
const ctx = await createContext(config, { models: null });
const app = createApp(ctx);

const perTeam = Math.ceil(PEOPLE / TEAMS);
const githubId = (team: number, i: number) => 1_000_000 + team * perTeam + i;
const slackId = (team: number, i: number) => `U${team}X${i}`;

async function call(path: string, token: string | null, body: unknown) {
  const res = await app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-setup-secret": config.SETUP_SECRET ?? "",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const answer: unknown = await res.json();
  return answer;
}

const Setup = z.object({ token: z.object({ token: z.string() }) });
const Created = z.object({ member: z.object({ id: z.string() }) });
const Connected = z.object({
  webhookUrls: z.record(z.string(), z.string()),
});

const run = Date.now().toString(36);
const channelId = (team: number, c: number) => `C${run}T${team}N${c}`;
const teams: { github: string; slack: string }[] = [];
for (let t = 0; t < TEAMS; t += 1) {
  const setup = Setup.parse(
    await call("/v1/setup", null, {
      workspaceName: `Bench ${run} ${t}`,
      name: "Owner",
      email: `owner-${run}-${t}@bench.test`,
    })
  );
  const github = Connected.parse(
    await call("/v1/connections", setup.token.token, {
      provider: "github",
      secrets: { webhookSecret: "bench" },
    })
  );
  const slack = Connected.parse(
    await call("/v1/connections", setup.token.token, {
      provider: "slack",
      secrets: { signingSecret: "bench", botToken: "xoxb-bench" },
      settings: {
        channels: Array.from({ length: Math.ceil(CHANNELS * 0.75) }, (_, c) =>
          channelId(t, c)
        ),
      },
    })
  );
  for (let i = 0; i < MEMBERS; i += 1) {
    const { member } = Created.parse(
      await call("/v1/members", setup.token.token, {
        kind: "human",
        name: `Dev ${t}-${i}`,
      })
    );
    for (const [provider, externalId] of [
      ["github", String(githubId(t, i))],
      ["slack", slackId(t, i)],
    ]) {
      await call(`/v1/members/${member.id}/identities`, setup.token.token, {
        provider,
        externalId,
      });
    }
  }
  teams.push({
    github: new URL(github.webhookUrls.webhook ?? "").pathname,
    slack: new URL(slack.webhookUrls.events ?? "").pathname,
  });
}

const pick = (n: number) => Math.floor(Math.random() * n);
const someone = () =>
  MEMBERS > 0 && Math.random() < 0.5 ? pick(MEMBERS) : pick(perTeam);
let sequence = 0;

type Outgoing = { path: string; headers: Record<string, string>; raw: string };

function githubEvent(team: number) {
  sequence += 1;
  const repo = pick(REPOS);
  const repository = {
    id: team * 10_000 + repo,
    full_name: `bench-${team}/repo-${repo}`,
    default_branch: "main",
  };
  const person = (i: number) => ({
    login: `dev-${team}-${i}`,
    id: githubId(team, i),
  });
  const actor = person(someone());
  const pr = {
    number: 1 + pick(50),
    title: "Work in progress",
    html_url: "https://github.com/x/y/pull/1",
    user: actor,
    updated_at: new Date().toISOString(),
  };
  const roll = Math.random();
  if (roll < 0.45) {
    return {
      event: "push",
      payload: {
        ref: `refs/heads/feature-${pick(5)}`,
        after: `sha-${run}-${sequence}`,
        repository,
        sender: actor,
        commits: [{ id: `c-${sequence}`, message: "Step forward" }],
      },
    };
  }
  if (roll < 0.75) {
    return {
      event: "issue_comment",
      payload: {
        action: "created",
        repository,
        sender: actor,
        issue: { ...pr, pull_request: {} },
        comment: {
          id: sequence,
          body: `Looks good @${person(someone()).login}`,
          html_url: "c",
          user: actor,
          created_at: new Date().toISOString(),
        },
      },
    };
  }
  if (roll < 0.9) {
    return {
      event: "pull_request",
      payload: {
        action: "review_requested",
        repository,
        sender: actor,
        requested_reviewer: person(someone()),
        pull_request: {
          ...pr,
          updated_at: new Date(Date.now() - sequence).toISOString(),
        },
      },
    };
  }
  const reviewer = person(someone());
  return {
    event: "pull_request_review",
    payload: {
      action: "submitted",
      repository,
      sender: reviewer,
      pull_request: pr,
      review: {
        id: sequence,
        state: "approved",
        body: "Ship it",
        html_url: "r",
        user: reviewer,
        submitted_at: new Date().toISOString(),
      },
    },
  };
}

function githubRequest(team: number) {
  const { event, payload } = githubEvent(team);
  const raw = JSON.stringify(payload);
  return {
    path: teams[team]?.github ?? "",
    headers: {
      "x-github-event": event,
      "x-github-delivery": `${run}-${sequence}`,
      "x-hub-signature-256": `sha256=${hmacHex("bench", raw)}`,
    },
    raw,
  } satisfies Outgoing;
}

const recentThreads: string[] = [];

function slackRequest(team: number) {
  sequence += 1;
  const user = (i: number) => slackId(team, i);
  const ts = `${Math.floor(Date.now() / 1000)}.${String(sequence % 1_000_000).padStart(6, "0")}`;
  const roll = Math.random();
  let text = `Shipped the ${pick(100)} migration to staging, watching the error rate`;
  if (roll < 0.3) {
    text = "ok";
  } else if (roll < 0.45) {
    text = `<@${user(someone())}> can you look at the deploy before lunch?`;
  }
  const thread =
    Math.random() < 0.25 && recentThreads.length > 0
      ? recentThreads[pick(recentThreads.length)]
      : undefined;
  if (!thread) {
    recentThreads.push(ts);
    if (recentThreads.length > 200) {
      recentThreads.shift();
    }
  }
  const raw = JSON.stringify({
    type: "event_callback",
    team_id: `T${team}`,
    event_id: `Ev${run}${sequence}`,
    event: {
      type: "message",
      channel: channelId(team, pick(CHANNELS)),
      channel_type: "channel",
      user: user(someone()),
      text,
      ts,
      ...(thread ? { thread_ts: thread } : {}),
    },
  });
  const at = String(Math.floor(Date.now() / 1000));
  return {
    path: teams[team]?.slack ?? "",
    headers: {
      "x-slack-request-timestamp": at,
      "x-slack-signature": `v0=${hmacHex("bench", `v0:${at}:${raw}`)}`,
    },
    raw,
  } satisfies Outgoing;
}

const apiPorts: number[] = [];
const ackMs: number[] = [];
const refused = new Map<string, number>();
let sent = 0;

async function sendOne() {
  sent += 1;
  const team = pick(TEAMS);
  const req = Math.random() < SLACK ? slackRequest(team) : githubRequest(team);
  const started = performance.now();
  const init = {
    method: "POST",
    headers: { "content-type": "application/json", ...req.headers },
    body: req.raw,
  };
  const port = apiPorts[sent % Math.max(apiPorts.length, 1)];
  const res =
    port === undefined
      ? await app.request(req.path, init)
      : await fetch(`http://127.0.0.1:${port}${req.path}`, init);
  ackMs.push(performance.now() - started);
  if (res.status !== 200) {
    const text = await res.text();
    const why = `${res.status} ${text.slice(0, 120)}`;
    refused.set(why, (refused.get(why) ?? 0) + 1);
  }
}

async function sender() {
  while (sent < DELIVERIES) {
    await sendOne();
  }
}

async function burst() {
  await Promise.all(Array.from({ length: IN_FLIGHT }, sender));
}

async function steady() {
  const total = Math.round(RATE * DURATION);
  const started = performance.now();
  const inflight = new Set<Promise<void>>();
  for (let i = 0; i < total; i += 1) {
    const wait = started + (i * 1000) / RATE - performance.now();
    if (wait > 0) {
      await sleep(wait);
    }
    const request: Promise<void> = sendOne().finally(() => {
      inflight.delete(request);
    });
    inflight.add(request);
    if (inflight.size >= IN_FLIGHT * 4) {
      await Promise.race(inflight);
    }
  }
  await Promise.all(inflight);
}

const percentile = (values: number[], p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  );
};

const ours = sql`connection_id in (select c.id from connections c join workspaces w on w.id = c.workspace_id where w.name like ${`Bench ${run}%`})`;
const waiting = async () => {
  const result = await ctx.db.execute<{ n: number }>(
    sql`select count(*)::int as n from inbound_events where ${ours} and status in ('pending', 'failed')`
  );
  return result.rows[0]?.n ?? 0;
};

function standInFetch() {
  return Object.assign(
    async (input: string | URL | Request) => {
      let url = input instanceof URL ? input : null;
      url ??= new URL(input instanceof Request ? input.url : input);
      const user = url.searchParams.get("user") ?? "someone";
      return await Promise.resolve(
        Response.json({
          ok: true,
          user: { name: user, real_name: user, profile: {} },
        })
      );
    },
    { preconnect: fetch.preconnect }
  );
}

async function untilSignalled() {
  // oxlint-disable-next-line promise/avoid-new -- the signal is the one thing to wait for.
  await new Promise((resolve) => {
    process.once("SIGTERM", resolve);
  });
}

async function work() {
  const wctx = await createContext(
    loadConfig({ ...process.env, OPENROUTER_API_KEY: "" }),
    { models: null, fetch: standInFetch() }
  );
  const stop = await startWorker(wctx);
  await untilSignalled();
  await stop();
  await wctx.close();
  process.exit(0);
}

async function serveApi() {
  const actx = await createContext(
    loadConfig({ ...process.env, OPENROUTER_API_KEY: "" }),
    { models: null, fetch: standInFetch() }
  );
  const stopRelay = await actx.bus.listen();
  const server = Bun.serve({
    port: Number(process.env.PORT),
    fetch: createApp(actx).fetch,
    idleTimeout: 0,
  });
  await untilSignalled();
  await server.stop();
  await stopRelay();
  await actx.close();
  process.exit(0);
}

async function startApis() {
  const started = Array.from({ length: APIS }, (_, i) => {
    const port = 4100 + i;
    apiPorts.push(port);
    return Bun.spawn(["bun", "scripts/bench-ingest.ts", "--api"], {
      env: { ...process.env, PORT: String(port), DATABASE_POOL_SIZE: "20" },
      stdout: "ignore",
      stderr: "inherit",
    });
  });
  for (const port of apiPorts) {
    for (;;) {
      const up = await fetch(`http://127.0.0.1:${port}/v1/auth/config`).then(
        (r) => r.ok,
        () => false
      );
      if (up) {
        break;
      }
      await sleep(200);
    }
  }
  return started;
}

function usage(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const status = readFileSync(`/proc/${pid}/status`, "utf-8");
    const rss = /VmRSS:\s+(?<kb>\d+)/u.exec(status)?.groups?.kb ?? "0";
    return {
      cpu: (Number(fields[11]) + Number(fields[12])) / 100,
      mb: Math.round(Number(rss) / 1024),
    };
  } catch {
    return { cpu: 0, mb: 0 };
  }
}

function postgresPids() {
  return readdirSync("/proc").flatMap((entry) => {
    if (!/^\d+$/u.test(entry)) {
      return [];
    }
    try {
      return readFileSync(`/proc/${entry}/comm`, "utf-8").trim() === "postgres"
        ? [Number(entry)]
        : [];
    } catch {
      return [];
    }
  });
}

function postgresCpu(from: Map<number, number>) {
  let total = 0;
  for (const pid of postgresPids()) {
    total += usage(pid).cpu - (from.get(pid) ?? 0);
  }
  return total;
}

function startWorkers(count = WORKERS) {
  return Array.from({ length: count }, () =>
    Bun.spawn(["bun", "scripts/bench-ingest.ts", "--worker"], {
      env: {
        ...process.env,
        WORKER_CONCURRENCY: String(CONCURRENCY),
        DATABASE_POOL_SIZE: String(CONCURRENCY + 2),
      },
      stdout: "ignore",
      stderr: "inherit",
    })
  );
}

const backlog: number[] = [];
const memory = new Map<number, number[]>();
const sampling = new AbortController();
let watched: number[] = [];
async function sample() {
  let tick = 0;
  while (!sampling.signal.aborted) {
    backlog.push(await waiting());
    if (tick % 5 === 0) {
      for (const pid of watched) {
        memory.set(pid, [...(memory.get(pid) ?? []), usage(pid).mb]);
      }
    }
    tick += 1;
    await sleep(1000);
  }
}

let workers: ReturnType<typeof startWorkers> = [];
const chaos: { killed?: { atSeconds: number; pid: number } } = {};

async function killAWorker() {
  await sleep(KILL_AT * 1000);
  const [victim] = workers;
  const [replacement] = startWorkers(1);
  if (!victim || !replacement) {
    return;
  }
  victim.kill("SIGKILL");
  chaos.killed = { atSeconds: KILL_AT, pid: victim.pid };
  workers[0] = replacement;
  watched = [...watched.filter((pid) => pid !== victim.pid), replacement.pid];
}

const apis = await startApis();
const receiving = performance.now();
let sampler: Promise<void> = Promise.resolve();
let cpuFrom = new Map<number, number>();
if (RATE > 0) {
  workers = startWorkers();
  watched = [
    process.pid,
    ...apis.map((a) => a.pid),
    ...workers.map((w) => w.pid),
  ];
  cpuFrom = new Map(
    [...watched, ...postgresPids()].map((pid) => [pid, usage(pid).cpu])
  );
  sampler = sample();
  const killing = KILL_AT > 0 ? killAWorker() : Promise.resolve();
  await steady();
  await killing;
} else {
  await burst();
}
const received = (performance.now() - receiving) / 1000;
const processing = performance.now();
if (RATE === 0) {
  workers = startWorkers();
}
while ((await waiting()) > 0) {
  await sleep(250);
}
const drained = (performance.now() - processing) / 1000;
sampling.abort();
await sampler;
const wall = (performance.now() - receiving) / 1000;
const memoryOf = (pid: number) => {
  const mb = memory.get(pid) ?? [];
  return [mb[0], Math.max(...mb), mb.at(-1)];
};
const cores = (pid: number) =>
  Number(((usage(pid).cpu - (cpuFrom.get(pid) ?? 0)) / wall).toFixed(2));
const resources =
  RATE > 0
    ? {
        seconds: Math.round(wall),
        cpu: {
          load: cores(process.pid),
          apis: apis.map((a) => cores(a.pid)),
          workers: workers.map((w) => cores(w.pid)),
          postgres: Number((postgresCpu(cpuFrom) / wall).toFixed(2)),
        },
        memoryMb: {
          load: [process.pid].map(memoryOf),
          apis: apis.map((a) => memoryOf(a.pid)),
          workers: workers.map((w) => memoryOf(w.pid)),
        },
      }
    : undefined;
for (const child of [...workers, ...apis]) {
  child.kill("SIGTERM");
}
await Promise.all(
  [...workers, ...apis].map(async (child) => await child.exited)
);
await ctx.tally.flush();

const stats = await ctx.db.execute<{
  status: string;
  n: number;
  attempts: number;
}>(
  sql`select status, count(*)::int as n, max(attempts)::int as attempts from inbound_events where ${ours} group by 1 order by 1`
);
const lag = await ctx.db.execute<{ p50: number; p95: number; p99: number }>(
  sql`select
    round(percentile_cont(0.5) within group (order by ms))::int as p50,
    round(percentile_cont(0.95) within group (order by ms))::int as p95,
    round(percentile_cont(0.99) within group (order by ms))::int as p99
  from (select extract(epoch from processed_at - received_at) * 1000 as ms
    from inbound_events where ${ours} and processed_at is not null) d`
);
const activities = await ctx.db.execute<{ n: number }>(
  sql`select count(*)::int as n from activities where ${ours}`
);
const attention = await ctx.db.execute<{ n: number }>(
  sql`select count(*)::int as n from attention_items a join workspaces w on w.id = a.workspace_id where w.name like ${`Bench ${run}%`}`
);
const recovery = await ctx.db.execute<{ retried: number; doubled: number }>(
  sql`select
    count(*) filter (where attempts > 1)::int as retried,
    count(*) filter (where (outcome->>'duplicates')::int > 0)::int as doubled
  from inbound_events where ${ours}`
);
const identities = await ctx.db.execute<{ n: number }>(
  sql`select count(*)::int as n from identities i join workspaces w on w.id = i.workspace_id where w.name like ${`Bench ${run}%`}`
);

console.log(
  JSON.stringify(
    {
      setup: {
        teams: TEAMS,
        people: PEOPLE,
        repos: REPOS * TEAMS,
        channels: CHANNELS * TEAMS,
        slackShare: SLACK,
        apis: APIS,
        workers: WORKERS,
        jobsPerWorker: CONCURRENCY,
      },
      receive: {
        deliveries: sent,
        perSecond: Math.round(sent / received),
        ackMs: {
          p50: Math.round(percentile(ackMs, 0.5)),
          p95: Math.round(percentile(ackMs, 0.95)),
          p99: Math.round(percentile(ackMs, 0.99)),
        },
      },
      process:
        RATE > 0
          ? {
              target: RATE,
              seconds: DURATION,
              backlog: {
                max: Math.max(0, ...backlog),
                last10s: backlog.slice(-10),
              },
              drainedAfterSendingSeconds: Number(drained.toFixed(1)),
            }
          : {
              seconds: Number(drained.toFixed(1)),
              perSecond: Math.round(sent / drained),
            },
      refused: Object.fromEntries(refused),
      ...(chaos.killed
        ? { killed: chaos.killed, recovery: recovery.rows[0] }
        : {}),
      resources,
      receivedToDoneMs: lag.rows[0],
      outcome: stats.rows,
      activities: activities.rows[0]?.n,
      attentionItems: attention.rows[0]?.n,
      identities: identities.rows[0]?.n,
    },
    null,
    2
  )
);
await ctx.close();
process.exit(0);
