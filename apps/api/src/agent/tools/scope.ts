import type { AppContext } from "#context";
import type { Member } from "#db/queries/members";
import { ApiError } from "#lib/errors";

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

// Expected failures (unknown card, bad column name) become results the model can recover from;
// they're logged so they still show up in observability. An error that says what to do next
// ("use search_cards to find its number") gets a model further than one that only says what failed.
export function safe<I, O>(
  fn: (input: I) => Promise<O>,
  next: { notFound?: string } = {}
) {
  return async (input: I) => {
    try {
      return capped(await fn(input));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[agent] tool failed: ${message}`);
      const hint =
        error instanceof ApiError && error.status === 404
          ? next.notFound
          : undefined;
      return { error: hint === undefined ? message : `${message}. ${hint}` };
    }
  };
}

// Privacy is enforced by what the tools query, not by the prompt: only the owner, in their own
// conversation, sees their private work.
export function privateFor(scope: Scope) {
  return scope.mode === "owner" ? [scope.owner.id] : [];
}

export function includesPrivate(scope: Scope, person: Member) {
  return scope.mode === "owner" && person.id === scope.owner.id;
}

/** About 3,000 tokens: more than a lookup should hand the conversation in one go. */
const MAX_RESULT_CHARS = 12_000;

// A list too long for the conversation keeps its first items and says how to narrow it, so one
// broad search can't crowd out everything else the model is holding.
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
