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
  // Queued before lanes were drained as a whole.
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
    // Queued before replays ran per lane.
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
      console.log(`[scheduler] ${gone} installation(s) were removed`);
    }
    const n = await reconcileAll(ctx);
    if (n) {
      console.log(`[scheduler] catching up ${n} connection(s)`);
    }
  },
  "secrets:reseal": async (ctx) => {
    const n = await resealSecrets(ctx);
    if (n) {
      console.log(`[scheduler] re-sealed ${n} secret(s) with the current key`);
    }
  },
  "connections:silence": async (ctx) => {
    const n = await noticeSilence(ctx);
    if (n) {
      console.log(`[scheduler] ${n} connection(s) went quiet`);
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
      console.log(`[scheduler] queued ${queued} automation(s)`);
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
      console.log(`[scheduler] postponed ${postponed} card(s)`);
    }
  },
  "jobs:release": async (ctx) => {
    const n = await releaseAbandonedJobs(ctx);
    if (n) {
      console.log(`[scheduler] released ${n} job(s) whose worker died`);
    }
  },
  "ingest:sweep": async (ctx) => {
    const n = await drainStranded(ctx);
    if (n) {
      console.log(`[scheduler] ${n} lane(s) had deliveries left waiting`);
    }
  },
  "events:prune": async (ctx) => {
    await ctx.bus.prune(new Date(ctx.now().getTime() - 7 * DAY_MS));
  },
  "inbound:prune": async (ctx) => {
    await pruneIngestState(ctx);
    const pruned = await pruneDeliveries(ctx);
    if (pruned) {
      console.log(`[scheduler] pruned ${pruned} stored webhook(s)`);
    }
  },
};

// One queue, so scheduled tasks never overlap. No retries: the next run catches up on whatever is due.
// The sweeps stay off that queue, so a long or stuck task there can't hold them up (releasing
// abandoned jobs frees that queue too); two at once do no harm.
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
  return async () => {
    await runner.stop();
  };
}

// runOnce stops when no job is free to run, and a job queued behind a running one in its lane isn't
// free yet, so one pass can leave work behind.
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

function taskList(ctx: AppContext): TaskList {
  return Object.fromEntries(
    Object.entries(TASKS).map(([name, handle]) => [
      name,
      async (payload: unknown) => {
        await handle(ctx, PayloadSchema.parse(payload ?? {}));
      },
    ])
  );
}
