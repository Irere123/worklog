import type { AppContext } from "#context";
import type { Member } from "#db/queries/members";

export type Scope = {
  ctx: AppContext;
  agent: Member;
  owner: Member;
  asker: Member;
  mode: "owner" | "teammate";
  conversationId: string;
};

// Expected failures (unknown card, bad column name) become results the model can recover from;
// they're logged so they still show up in observability.
export function safe<I, O>(fn: (input: I) => Promise<O>) {
  return async (input: I) => {
    try {
      return await fn(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[agent] tool failed: ${message}`);
      return { error: message };
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
