import type { AppContext } from "#context";
import type { Member } from "#db/queries/members";
import { ApiError } from "#lib/errors";
import { log } from "#telemetry/log";

export type Scope = {
  ctx: AppContext;
  agent: Member;
  owner: Member;
  asker: Member;
  mode: "owner" | "teammate";
  conversationId: string;
  /** What the person asking typed this turn, which the review of a visible write reads. */
  said: string;
};

export function safe<I, O>(
  fn: (input: I) => Promise<O>,
  next: { notFound?: string } = {}
) {
  return async (input: I) => {
    try {
      return capped(await fn(input));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("agent: tool failed", { error });
      const hint =
        error instanceof ApiError && error.status === 404
          ? next.notFound
          : undefined;
      return { error: hint === undefined ? message : `${message}. ${hint}` };
    }
  };
}

export function privateFor(scope: Scope) {
  return scope.mode === "owner" ? [scope.owner.id] : [];
}

export function includesPrivate(scope: Scope, person: Member) {
  return scope.mode === "owner" && person.id === scope.owner.id;
}

const MAX_RESULT_CHARS = 12_000;

function capped<O>(result: O) {
  if (
    !Array.isArray(result) ||
    JSON.stringify(result).length <= MAX_RESULT_CHARS
  ) {
    return result;
  }
  const kept: unknown[] = [];
  let size = 2;
  for (const item of result) {
    size += JSON.stringify(item).length + 1;
    if (size > MAX_RESULT_CHARS) {
      break;
    }
    kept.push(item);
  }
  return {
    items: kept,
    shown: kept.length,
    total: result.length,
    next: "Only the first results fit. Narrow the search (a person, a card, a kind, fewer days) to see the rest.",
  };
}
