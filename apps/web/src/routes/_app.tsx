import { createFileRoute, redirect } from "@tanstack/react-router";

import { ApiError } from "#api/client";
import { q } from "#api/queries";
import { Shell } from "#features/shell/shell";

export type AppSearch = { card?: number };

export const Route = createFileRoute("/_app")({
  ssr: false,
  // Any page can open a card over itself: the card lives in the URL, so links and Back work.
  validateSearch: (search: Record<string, unknown>): AppSearch => {
    const card = Number(search.card);
    return Number.isInteger(card) && card > 0 ? { card } : {};
  },
  beforeLoad: async ({ context, location }) => {
    try {
      const session = await context.queryClient.query({
        ...q.session(),
        staleTime: "static",
      });
      await context.queryClient.query({ ...q.me(), staleTime: "static" });
      return { session };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirect({
          to: "/login",
          search: { next: location.href },
          throw: true,
        });
      }
      if (error instanceof ApiError && error.code === "no_workspace") {
        redirect({ to: "/setup", throw: true });
      }
      throw error;
    }
  },
  component: Shell,
});
