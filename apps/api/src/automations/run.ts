import { runConsolidate } from "#agent/memory/consolidate";
import type { AppContext } from "#context";
import {
  claimDueAutomations,
  findAutomationById,
  insertAutomationRun,
  updateAutomationById,
} from "#db/queries/automations";
import type { Automation } from "#db/queries/automations";
import { findMemberById } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import { transact } from "#db/transact";
import { enqueue } from "#jobs/queue";
import { notFound } from "#lib/errors";
import { newId } from "#lib/ids";
import { timezoneOf } from "#lib/time";
import { raiseAttention } from "#work/attention";

import { runBrief, runCheck, runCustom, runDigest } from "./runners";
import type { RunOutcome } from "./runners";
import { jitterFor, nextRun } from "./schedule";

const FAILURE_ALERT_AT = 3;
const FAILURE_DISABLE_AT = 10;
/**
 * How long a queued run has before its automation comes due again, if its job is gone. A worker
 * that died mid-run holds its job, and the person's queue, until Graphile frees stale locks (four
 * hours); the claim keeps that job from running the automation again if it had finished.
 */
const LEASE_MS = 15 * 60_000;

/**
 * Queues a run for everything due, to run on any worker: briefs wait on a model for seconds each,
 * so the morning's briefs of a few thousand people can't run one after another in the scheduler.
 * One person's automations queue behind each other. Returns how many were queued.
 */
export async function queueDueAutomations(
  ctx: AppContext,
  opts: { batch?: number } = {}
) {
  const batch = opts.batch ?? 200;
  let queued = 0;
  for (;;) {
    const claimed = await transact(ctx, async (tx) => {
      const now = tx.now();
      const rows = await claimDueAutomations(tx.db, {
        now,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        limit: batch,
      });
      for (const row of rows) {
        await enqueue(
          tx,
          "automation:run",
          { automationId: row.id, claimedAt: now.toISOString() },
          {
            queue: `automations:${row.memberId}`,
            key: `automation:${row.id}`,
            maxAttempts: 3,
          }
        );
      }
      return rows.length;
    });
    queued += claimed;
    if (claimed < batch) {
      return queued;
    }
  }
}

/**
 * The job `queueDueAutomations` queued, if its claim still stands. The scheduled run clears it in
 * the transaction that records the run, so a retry after the run finished (its event wasn't
 * published, or its worker died before saying it was done) does nothing, and neither does a
 * second job queued while a slow run outlasted its lease. Edits, manual runs and checks pulled
 * earlier leave it alone.
 */
export async function runQueuedAutomation(
  ctx: AppContext,
  id: string,
  claimedAt: string | null
) {
  const automation = await findAutomationById(ctx.db, { id });
  const claimed =
    claimedAt === null ||
    automation?.claimedAt?.getTime() === Date.parse(claimedAt);
  if (automation?.enabled === true && claimed) {
    await runAutomation(ctx, automation);
  }
}

export async function runAutomation(
  ctx: AppContext,
  automation: Automation,
  opts: { manual?: boolean } = {}
) {
  const startedAt = ctx.now();
  const member = await findMemberById(ctx.db, { id: automation.memberId });
  if (!member) {
    throw notFound("Member");
  }
  const tz = timezoneOf(
    member,
    await getWorkspaceById(ctx.db, { id: member.workspaceId })
  );

  let outcome: RunOutcome;
  let error: string | null = null;
  try {
    outcome = await execute(ctx, automation, member, tz, opts.manual ?? false);
  } catch (error_) {
    error = error_ instanceof Error ? error_.message : String(error_);
    outcome = { status: "failed", summary: error };
  }

  const failureCount =
    outcome.status === "failed" ? automation.failureCount + 1 : 0;
  const state =
    outcome.status === "delivered" || outcome.status === "quiet"
      ? {
          ...automation.state,
          lastResult: {
            status: outcome.status,
            summary: outcome.summary,
            at: startedAt.toISOString(),
          },
        }
      : automation.state;
  await transact(ctx, async (tx) => {
    await updateAutomationById(tx.db, {
      id: automation.id,
      set: {
        lastRunAt: startedAt,
        lastStatus: outcome.status,
        failureCount,
        state,
        // Only to turn it off: written back as loaded, it would undo someone turning it off
        // while it ran.
        ...(failureCount >= FAILURE_DISABLE_AT ? { enabled: false } : {}),
        ...(opts.manual === true ? {} : { claimedAt: null }),
        nextRunAt:
          opts.manual === true
            ? automation.nextRunAt
            : nextRun(
                automation.schedule,
                tz,
                tx.now(),
                member.settings,
                jitterFor(automation.id)
              ),
      },
    });
    await insertAutomationRun(tx.db, {
      id: newId("run"),
      automationId: automation.id,
      status: outcome.status,
      summary: outcome.summary.slice(0, 2000),
      error,
      startedAt,
    });
  });
  if (
    failureCount === FAILURE_ALERT_AT ||
    failureCount === FAILURE_DISABLE_AT
  ) {
    await raiseAttention(ctx, {
      workspaceId: member.workspaceId,
      memberId: member.id,
      kind: "automation.failing",
      title:
        failureCount >= FAILURE_DISABLE_AT
          ? `"${automation.name}" was turned off after ${failureCount} failures`
          : `"${automation.name}" has failed ${failureCount} times in a row`,
      body: error,
      priority: "normal",
      dedupeKey: `automation:${automation.id}`,
    });
  }
  await ctx.bus.publish({
    workspaceId: member.workspaceId,
    audienceId: member.id,
    type: "automation.ran",
    data: {
      id: automation.id,
      kind: automation.kind,
      status: outcome.status,
      summary: outcome.summary.slice(0, 280),
    },
  });
  return { automationId: automation.id, ...outcome };
}

async function execute(
  ctx: AppContext,
  automation: Automation,
  member: Member,
  tz: string,
  manual: boolean
): Promise<RunOutcome> {
  switch (automation.kind) {
    case "brief.daily":
    case "brief.weekly": {
      return await runBrief(ctx, automation, member);
    }
    case "digest": {
      return await runDigest(ctx, automation, member);
    }
    case "check": {
      return await runCheck(ctx, automation, member, tz, manual);
    }
    case "consolidate": {
      return await runConsolidate(ctx, member, tz);
    }
    case "custom": {
      return await runCustom(ctx, automation, member);
    }
    default: {
      throw new Error(
        `Unknown automation kind: ${String(automation.kind satisfies never)}`
      );
    }
  }
}
