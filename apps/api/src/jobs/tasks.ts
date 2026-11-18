import { parseCrontab, run, runOnce } from "graphile-worker";
import type { TaskList } from "graphile-worker";
import { z } from "zod";

import { compactConversation } from "#agent/compaction";
import { settleConversation } from "#agent/settle";
import { queueDueAutomations, runQueuedAutomation } from "#automations/run";
import type { AppContext } from "#context";
import { countRunnableJobs } from "#db/queries/jobs";
import { enrichIdentity } from "#ingest/enrich";
import { followUp } from "#ingest/follow-up";
import { ensureHooks } from "#ingest/hooks";
import { reconcileInstallations } from "#ingest/installations";
import { drainStranded } from "#ingest/pipeline";
import {
  drainLane,
  processInbound,
  queueReplay,
  replayLane,
} from "#ingest/process";
import { resealSecrets } from "#ingest/reseal";
import { pruneDeliveries, pruneIngestState } from "#ingest/retention";
import { noticeSilence } from "#ingest/silence";
import { reconcileAll, syncConnection, syncStream } from "#ingest/sync";
import { DAY_MS } from "#lib/time";
import { log } from "#telemetry/log";
import { activeSpan, traced } from "#telemetry/trace";
import { nudgeDrifting, sweepEntropy } from "#work/drift";

import { logger, releaseAbandonedJobs } from "./queue";

type Payload = Record<string, unknown>;

const TASKS: Record<
  string,
  (ctx: AppContext, payload: Payload) => Promise<void>
> = {
  "ingest:lane": async (ctx, payload) => {
    await drainLane(ctx, String(payload.connectionId), Number(payload.lane));
  },
  "ingest:process": async (ctx, payload) => {
    await processInbound(ctx, String(payload.inboundEventId));
  },
  "ingest:replay": async (ctx, payload) => {
    const since =
      typeof payload.since === "string" ? new Date(payload.since) : undefined;
    const conn = {
      id: String(payload.connectionId),
      workspaceId: String(payload.workspaceId),
    };
    if (typeof payload.lane !== "number") {
      await queueReplay(ctx, conn, since);
      return;
    }
    await replayLane(ctx, {
      workspaceId: conn.workspaceId,
      connectionId: conn.id,
      lane: payload.lane,
      since,
    });
  },
  "sync:connection": async (ctx, payload) => {
    await syncConnection(
      ctx,
      String(payload.connectionId),
      Array.isArray(payload.streams) ? payload.streams.map(String) : null
    );
  },
  "sync:stream": async (ctx, payload) => {
    await syncStream(ctx, String(payload.connectionId), String(payload.stream));
  },
  "sync:reconcile": async (ctx) => {
    const gone = await reconcileInstallations(ctx);
    if (gone) {
      log.info("scheduler: installations were removed", { count: gone });
    }
    const n = await reconcileAll(ctx);
    if (n) {
      log.info("scheduler: catching up connections", { count: n });
    }
  },
  "secrets:reseal": async (ctx) => {
    const n = await resealSecrets(ctx);
    if (n) {
      log.info("scheduler: re-sealed secrets with the current key", {
        count: n,
      });
    }
  },
  "connections:silence": async (ctx) => {
    const n = await noticeSilence(ctx);
    if (n) {
      log.info("scheduler: connections went quiet", { count: n });
    }
  },
  "identity:enrich": async (ctx, payload) => {
    await enrichIdentity(ctx, String(payload.identityId));
  },
  "hooks:ensure": async (ctx, payload) => {
    await ensureHooks(ctx, String(payload.connectionId));
  },
  "chat:follow-up": async (ctx, payload) => {
    await followUp(ctx, payload);
  },
  "conversation:compact": async (ctx, payload) => {
    await compactConversation(
      ctx,
      String(payload.workspaceId),
      String(payload.conversationId)
    );
  },
  "conversation:settle": async (ctx, payload) => {
    await settleConversation(
      ctx,
      String(payload.workspaceId),
      String(payload.conversationId)
    );
  },
  "automations:run": async (ctx) => {
    const queued = await queueDueAutomations(ctx);
    if (queued) {
      log.info("scheduler: queued automations", { count: queued });
    }
  },
  "automation:run": async (ctx, payload) => {
    await runQueuedAutomation(
      ctx,
      String(payload.automationId),
      typeof payload.claimedAt === "string" ? payload.claimedAt : null
    );
  },
  "board:entropy": async (ctx) => {
    const postponed = await sweepEntropy(ctx);
    await nudgeDrifting(ctx);
    if (postponed) {
      log.info("scheduler: postponed cards", { count: postponed });
    }
  },
  "jobs:release": async (ctx) => {
    const n = await releaseAbandonedJobs(ctx);
    if (n) {
      log.info("scheduler: released jobs whose worker died", { count: n });
    }
  },
  "ingest:sweep": async (ctx) => {
    const n = await drainStranded(ctx);
    if (n) {
      log.info("scheduler: lanes had deliveries left waiting", { count: n });
    }
  },
  "events:prune": async (ctx) => {
    await ctx.bus.prune(new Date(ctx.now().getTime() - 7 * DAY_MS));
  },
  "inbound:prune": async (ctx) => {
    await pruneIngestState(ctx);
    const pruned = await pruneDeliveries(ctx);
    if (pruned) {
      log.info("scheduler: pruned stored webhooks", { count: pruned });
    }
  },
};

const CRONTAB = `
* * * * * ingest:sweep ?max=1
*/5 * * * * jobs:release ?max=1
* * * * * automations:run ?queue=scheduler&max=1
0 * * * * board:entropy ?queue=scheduler&max=1
0 3 * * * events:prune ?queue=scheduler&max=1
30 3 * * * inbound:prune ?queue=scheduler&max=1
0 4 * * * sync:reconcile ?queue=scheduler&max=1
15 * * * * connections:silence ?queue=scheduler&max=1
45 3 * * * secrets:reseal ?queue=scheduler&max=1
`;

export async function startWorker(
  ctx: AppContext,
  opts: { cron?: boolean; concurrency?: number } = {}
) {
  const runner = await run({
    pgPool: ctx.pool,
    taskList: taskList(ctx),
    parsedCronItems: parseCrontab(opts.cron === false ? "" : CRONTAB),
    concurrency: opts.concurrency ?? ctx.config.WORKER_CONCURRENCY,
    noHandleSignals: true,
    logger,
  });
  return Object.assign(
    async () => {
      await runner.stop();
    },
    { done: runner.promise }
  );
}

/**
 * Runs `exit` if the runner stops while the process isn't shutting down (it lost the database for
 * good, say): a process that outlives its runner takes no jobs while looking alive, and exiting
 * lets the platform restart it.
 */
export async function exitWhenRunnerStops(
  done: Promise<void>,
  opts: { stopping: () => boolean; exit: () => Promise<void> }
) {
  try {
    await done;
    if (!opts.stopping()) {
      log.error("jobs: the runner stopped on its own");
    }
  } catch (error) {
    log.error("jobs: the runner failed", { error });
  }
  if (!opts.stopping()) {
    await opts.exit();
  }
}

export async function runJobsOnce(ctx: AppContext) {
  for (let pass = 0; pass < 100; pass += 1) {
    await runOnce({
      pgPool: ctx.pool,
      taskList: taskList(ctx),
      noHandleSignals: true,
      logger,
    });
    if ((await countRunnableJobs(ctx.db)) === 0) {
      return;
    }
  }
}

const PayloadSchema = z.record(z.string(), z.unknown());

function taskList(ctx: AppContext) {
  const tasks: TaskList = Object.fromEntries(
    Object.entries(TASKS).map(([name, handle]) => [
      name,
      async (payload: unknown, helpers) => {
        const { job } = helpers;
        await traced(
          `job ${name}`,
          {
            "job.task": name,
            "job.id": job.id,
            "job.attempt": job.attempts,
            "job.max_attempts": job.max_attempts,
            "job.wait_ms": Math.max(0, Date.now() - job.run_at.getTime()),
            "workspace.id": workspaceOf(payload),
          },
          async () => {
            try {
              await handle(ctx, PayloadSchema.parse(payload ?? {}));
            } catch (error) {
              const final = job.attempts >= job.max_attempts;
              activeSpan()?.set({ "job.final": final });
              log.error("jobs: task failed", {
                error,
                task: name,
                attempt: job.attempts,
                maxAttempts: job.max_attempts,
                final,
              });
              throw error;
            }
          },
          { kind: "consumer", parent: null }
        );
      },
    ])
  );
  return tasks;
}

function workspaceOf(payload: unknown) {
  const parsed = PayloadSchema.safeParse(payload);
  const id = parsed.success ? parsed.data.workspaceId : null;
  return typeof id === "string" ? id : null;
}
