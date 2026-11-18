import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { Button } from "#ui/button";

export type Answer = "allow" | "deny";

/**
 * Answers a change the assistant holds for the owner's OK: the tap runs exactly what was proposed,
 * with no model in between. It leaves the open list at once and comes back if the server refuses.
 */
export function useAnswerApproval() {
  const client = useQueryClient();
  const open = q.attention("open").queryKey;
  return useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: Answer }) =>
      await unwrap(
        api.POST("/v1/attention/{id}/actions/{actionId}", {
          params: { path: { id, actionId: answer } },
        })
      ),
    onMutate: async ({ id }) => {
      await client.cancelQueries({ queryKey: open });
      const before = client.getQueryData(open);
      client.setQueryData(open, (list) => list?.filter((i) => i.id !== id));
      return { before };
    },
    onError: (error, _vars, context) => {
      client.setQueryData(open, context?.before);
      toast.error(error.message);
    },
    onSettled: () => {
      for (const queryKey of [["attention"], ["cards"], ["automations"]]) {
        void client.invalidateQueries({ queryKey });
      }
    },
  });
}

/** The two answers, wherever the assistant asks: in the chat, on its page, in the inbox. */
export function AllowDeny({
  onAnswer,
}: {
  onAnswer: (answer: Answer) => void;
}) {
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => onAnswer("allow")}>
        Allow
      </Button>
      <Button size="sm" onClick={() => onAnswer("deny")}>
        Deny
      </Button>
    </>
  );
}
