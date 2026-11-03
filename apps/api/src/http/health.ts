import { setTimeout as sleep } from "node:timers/promises";

import type { AppContext } from "#context";
import { pingDatabase } from "#db/queries/health";

const TIMEOUT_MS = 2000;

/**
 * What a deploy waits on before sending traffic and a container's health check asks: 503 once the
 * database stops answering, since neither process does anything useful without it.
 */
export async function healthReport(ctx: AppContext) {
  const db = await databaseAnswers(ctx);
  return {
    status: db ? 200 : 503,
    body: {
      ok: db,
      db,
      ai: ctx.models !== null,
      mailer: ctx.mailer.kind,
      release: ctx.config.WORKLOG_RELEASE,
    },
  } as const;
}

async function databaseAnswers(ctx: AppContext) {
  try {
    await Promise.race([
      pingDatabase(ctx.db),
      sleep(TIMEOUT_MS).then(() => {
        throw new Error("timed out");
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}
