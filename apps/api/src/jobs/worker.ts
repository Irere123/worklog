import { parseCrontab, run, runOnce } from "graphile-worker";
import type { TaskList } from "graphile-worker";
import { z } from "zod";

import { runDueAutomations } from "../automations/run";
import { nudgeDrifting, sweepEntropy } from "../board/service";
import type { AppContext } from "../context";
import { processInbound, replayConnection } from "../ingest/pipeline";
import { DAY_MS } from "../lib/time";
import { logger } from "./queue";

type Payload = Record<string, unknown>;

const TASKS: Record<
  string,
  (ctx: AppContext, payload: Payload) => Promise<void>
> = {
  "ingest:process": async (ctx, payload) => {
    await processInbound(ctx, String(payload.inboundEventId));
  },
  "ingest:replay": async (ctx, payload) => {
    await replayConnection(
      ctx,
      String(payload.workspaceId),
      String(payload.connectionId),
      typeof payload.since === "string" ? new Date(payload.since) : undefined
    );
  },
  "automations:run": async (ctx) => {
    const ran = await runDueAutomations(ctx);
    if (ran.length) {
      console.log(`[scheduler] ran ${ran.length} automation(s)`);
    }
  },
  "board:entropy": async (ctx) => {
    const postponed = await sweepEntropy(ctx);
    await nudgeDrifting(ctx);
    if (postponed) {
      console.log(`[scheduler] postponed ${postponed} card(s)`);
    }
  },
  "events:prune": async (ctx) => {
    await ctx.bus.prune(new Date(ctx.now().getTime() - 7 * DAY_MS));
  },
};

// One queue, so scheduled tasks never overlap. No retries: the next run catches up on whatever is due.
const CRONTAB = `
* * * * * automations:run ?queue=scheduler&max=1
0 * * * * board:entropy ?queue=scheduler&max=1
0 3 * * * events:prune ?queue=scheduler&max=1
`;

export async function startWorker(ctx: AppContext) {
  const runner = await run({
    pgPool: ctx.db.$client,
    taskList: taskList(ctx),
    parsedCronItems: parseCrontab(CRONTAB),
    concurrency: 4,
    noHandleSignals: true,
    logger,
  });
  return async () => {
    await runner.stop();
  };
}

export async function runJobsOnce(ctx: AppContext) {
  await runOnce({
    pgPool: ctx.db.$client,
    taskList: taskList(ctx),
    noHandleSignals: true,
    logger,
  });
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
