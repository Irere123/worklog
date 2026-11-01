import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { useMe } from "#features/auth/session";

type Me = NonNullable<ReturnType<typeof useMe>>;

// The stack is a handful of cards kept within reach, not a second board.
export const MAX_PINS = 12;

/**
 * Cards pinned to the stack, newest first. They live in the member's settings, so the stack on
 * a phone is the same one as on the desktop.
 */
export function usePins() {
  const me = useMe();
  const client = useQueryClient();
  const pins = me?.member.settings.pins ?? [];

  const save = useMutation({
    mutationFn: async (next: number[]) => {
      const settings = { ...me?.member.settings, pins: next };
      return await unwrap(api.PATCH("/v1/me", { body: { settings } }));
    },
    onMutate: async (next) => {
      await client.cancelQueries({ queryKey: ["me"] });
      const before = client.getQueryData<Me>(["me"]);
      if (before) {
        client.setQueryData<Me>(["me"], {
          ...before,
          member: {
            ...before.member,
            settings: { ...before.member.settings, pins: next },
          },
        });
      }
      return { before };
    },
    onError: (error, _next, context) => {
      if (context?.before) {
        client.setQueryData(["me"], context.before);
      }
      toast.error(error.message);
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const isPinned = (number: number) => pins.includes(number);
  const toggle = (number: number) => {
    if (isPinned(number)) {
      save.mutate(pins.filter((n) => n !== number));
      return;
    }
    if (pins.length >= MAX_PINS) {
      toast(`The stack holds ${MAX_PINS} cards. Unpin one first.`);
      return;
    }
    save.mutate([number, ...pins]);
  };

  return { pins, isPinned, toggle };
}
