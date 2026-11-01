import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";

type Card = Schemas["Card"];
type Path = { params: { path: { number: number } } };
type CardEdit = {
  title?: string;
  body?: string | null;
  dueOn?: string | null;
  tags?: string[];
  boardId?: string;
};

export type CardAction =
  | { type: "edit"; set: CardEdit }
  | { type: "move"; columnId: string }
  | { type: "triage" }
  | { type: "later" }
  | { type: "resume" }
  | { type: "close" }
  | { type: "reopen" }
  | { type: "gild" }
  | { type: "ungild" }
  | { type: "assign"; memberId: string }
  | { type: "unassign"; memberId: string }
  | { type: "watch" }
  | { type: "unwatch" };

async function perform(number: number, action: CardAction): Promise<unknown> {
  const path: Path = { params: { path: { number } } };
  switch (action.type) {
    case "edit": {
      return await unwrap(
        api.PATCH("/v1/cards/{number}", { ...path, body: action.set })
      );
    }
    case "move": {
      return await unwrap(
        api.POST("/v1/cards/{number}/triage", {
          ...path,
          body: { columnId: action.columnId },
        })
      );
    }
    case "triage": {
      return await unwrap(api.DELETE("/v1/cards/{number}/triage", path));
    }
    case "later": {
      return await unwrap(api.POST("/v1/cards/{number}/not_now", path));
    }
    case "resume": {
      return await unwrap(api.DELETE("/v1/cards/{number}/not_now", path));
    }
    case "close": {
      return await unwrap(api.POST("/v1/cards/{number}/closure", path));
    }
    case "reopen": {
      return await unwrap(api.DELETE("/v1/cards/{number}/closure", path));
    }
    case "gild": {
      return await unwrap(api.POST("/v1/cards/{number}/goldness", path));
    }
    case "ungild": {
      return await unwrap(api.DELETE("/v1/cards/{number}/goldness", path));
    }
    case "assign": {
      return await unwrap(
        api.POST("/v1/cards/{number}/assignments", {
          ...path,
          body: { memberId: action.memberId },
        })
      );
    }
    case "unassign": {
      return await unwrap(
        api.DELETE("/v1/cards/{number}/assignments/{memberId}", {
          params: { path: { number, memberId: action.memberId } },
        })
      );
    }
    case "watch": {
      return await unwrap(api.POST("/v1/cards/{number}/watch", path));
    }
    case "unwatch": {
      return await unwrap(api.DELETE("/v1/cards/{number}/watch", path));
    }
    default: {
      return undefined;
    }
  }
}

/** The local guess at what an action does, so the board moves before the server answers. */
function predict(
  card: Card,
  action: CardAction,
  columns: Map<string, string>
): Card {
  switch (action.type) {
    case "edit": {
      return { ...card, ...action.set };
    }
    case "move": {
      return {
        ...card,
        stage: "active",
        columnId: action.columnId,
        columnName: columns.get(action.columnId) ?? card.columnName,
      };
    }
    case "triage": {
      return { ...card, stage: "triage", columnId: null, columnName: null };
    }
    case "later": {
      return {
        ...card,
        stage: "not_now",
        postponedAt: new Date().toISOString(),
        autoPostponed: false,
      };
    }
    case "resume":
    case "reopen": {
      return {
        ...card,
        stage: card.columnId ? "active" : "triage",
        closedAt: null,
        postponedAt: null,
      };
    }
    case "close": {
      return { ...card, stage: "done", closedAt: new Date().toISOString() };
    }
    case "gild": {
      return { ...card, golden: true };
    }
    case "ungild": {
      return { ...card, golden: false };
    }
    case "assign": {
      return {
        ...card,
        assigneeIds: [...new Set([...card.assigneeIds, action.memberId])],
      };
    }
    case "unassign": {
      return {
        ...card,
        assigneeIds: card.assigneeIds.filter((id) => id !== action.memberId),
      };
    }
    case "watch":
    case "unwatch": {
      return card;
    }
    default: {
      return card;
    }
  }
}

const UNDO: Partial<Record<CardAction["type"], (card: Card) => CardAction>> = {
  close: () => ({ type: "reopen" }),
  later: () => ({ type: "resume" }),
  gild: () => ({ type: "ungild" }),
};

// Long enough to read the message and change your mind; the default four seconds isn't.
export const UNDO_MS = 8000;

const DONE_MESSAGE: Partial<Record<CardAction["type"], string>> = {
  close: "Marked done",
  later: "Moved to Not now",
  gild: "Golden ticket: it goes to the top",
};

/**
 * Every card change goes through here: optimistic in every cached card list and the open card,
 * rolled back if the server refuses, with Undo on the changes people regret.
 */
export function useCardActions(columns = new Map<string, string>()) {
  const client = useQueryClient();
  const revert = async (card: Card, action: CardAction) => {
    await perform(card.number, action);
    await client.invalidateQueries({ queryKey: ["cards"] });
    await client.invalidateQueries({ queryKey: ["card", card.number] });
  };
  return useMutation({
    mutationFn: async ({ card, action }: { card: Card; action: CardAction }) =>
      await perform(card.number, action),
    onMutate: async ({ card, action }) => {
      await client.cancelQueries({ queryKey: ["cards"] });
      await client.cancelQueries({ queryKey: ["card", card.number] });
      const lists = client.getQueriesData<Card[]>({ queryKey: ["cards"] });
      const detail = client.getQueryData<Card>(["card", card.number]);
      const next = predict(card, action, columns);
      for (const [key, list] of lists) {
        if (list) {
          client.setQueryData<Card[]>(
            key,
            list.map((c) => (c.number === card.number ? { ...c, ...next } : c))
          );
        }
      }
      if (detail) {
        client.setQueryData(["card", card.number], { ...detail, ...next });
      }
      return { lists, detail };
    },
    onError: (error, { card }, saved) => {
      for (const [key, list] of saved?.lists ?? []) {
        client.setQueryData(key, list);
      }
      if (saved?.detail) {
        client.setQueryData(["card", card.number], saved.detail);
      }
      toast.error(error.message);
    },
    onSuccess: (_result, { card, action }) => {
      const message = DONE_MESSAGE[action.type];
      const undo = UNDO[action.type];
      if (message) {
        toast(message, {
          duration: UNDO_MS,
          description: `#${card.number} ${card.title}`,
          action: undo
            ? {
                label: "Undo",
                onClick: () => {
                  void revert(card, undo(card));
                },
              }
            : undefined,
        });
      }
    },
    onSettled: (_r, _e, { card }) => {
      void client.invalidateQueries({ queryKey: ["cards"] });
      void client.invalidateQueries({ queryKey: ["card", card.number] });
      void client.invalidateQueries({ queryKey: ["activities", "recent"] });
    },
  });
}
