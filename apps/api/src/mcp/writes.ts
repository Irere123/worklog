import { runAction } from "#agent/actions";
import type { ActionName } from "#agent/actions";
import type { AppContext } from "#context";
import type { Member } from "#db/queries/members";
import { badRequest, tooMany } from "#lib/errors";
import type { AgentGrant } from "#work/agents";

import { reply } from "./reply";

const WRITE_BURST = 60;
const WRITE_REFILL_MS = 2000;

const writeBuckets = new Map<string, { left: number; at: number }>();

export async function act(
  ctx: AppContext,
  grant: AgentGrant,
  name: ActionName,
  input: unknown
) {
  return await reply(async () => {
    spendWrite(ctx, grant.agent);
    return outcome(await runAction(ctx, grant.agent, grant.owner, name, input));
  });
}

export function spendWrite(ctx: AppContext, agent: Member) {
  const now = ctx.now().getTime();
  const bucket = writeBuckets.get(agent.id);
  const left = bucket
    ? Math.min(WRITE_BURST, bucket.left + (now - bucket.at) / WRITE_REFILL_MS)
    : WRITE_BURST;
  if (left < 1) {
    const seconds = Math.ceil(((1 - left) * WRITE_REFILL_MS) / 1000);
    throw tooMany(
      `Too many changes in a short time. Try again in ${seconds}s, and report less often.`
    );
  }
  writeBuckets.set(agent.id, { left: left - 1, at: now });
}

function outcome(result: unknown) {
  if (typeof result !== "object" || result === null) {
    return result;
  }
  const rest = Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "ok" && key !== "id")
  );
  if (typeof rest.error === "string") {
    throw badRequest(rest.error);
  }
  return Object.keys(rest).length ? rest : "Done.";
}
