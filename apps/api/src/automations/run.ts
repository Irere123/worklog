import { runConsolidate } from "#agent/memory/consolidate";
import type { AppContext } from "#context";
import {
  insertAutomationRun,
  listDueAutomations,
  updateAutomationById,
} from "#db/queries/automations";
import type { Automation } from "#db/queries/automations";
import { findMemberById } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { getWorkspaceById } from "#db/queries/workspaces";
import { transact } from "#db/transact";
import { notFound } from "#lib/errors";
import { newId } from "#lib/ids";
import { timezoneOf } from "#lib/time";
import { raiseAttention } from "#work/attention";

import { runBrief, runCheck, runCustom, runDigest } from "./runners";
import type { RunOutcome } from "./runners";
import { jitterFor, nextRun } from "./schedule";

const FAILURE_ALERT_AT = 3;
const FAILURE_DISABLE_AT = 10;

export async function runDueAutomations(
  ctx: AppContext,
  opts: { batch?: number; budgetMs?: number } = {}
) {
  const batch = opts.batch ?? 25;
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const results = [];
  while (Date.now() < deadline) {
    const due = await listDueAutomations(ctx.db, {
      now: ctx.now(),
      limit: batch,
    });
    for (const automation of due) {
      results.push(await runAutomation(ctx, automation));
    }
    if (due.length < batch) {
      break;
    }
  }
  return results;
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
        enabled:
          failureCount >= FAILURE_DISABLE_AT ? false : automation.enabled,
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
