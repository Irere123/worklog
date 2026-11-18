import { createFileRoute, redirect } from "@tanstack/react-router";

import { ApiError } from "#api/client";
import { preloadShell } from "#api/preload";
import { q } from "#api/queries";
import { Shell } from "#features/shell/shell";
import { rememberSignedIn } from "#lib/boot";

export type AppSearch = { card?: number };

export const Route = createFileRoute("/_app")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => {
    const card = Number(search.card);
    const result: AppSearch =
      Number.isInteger(card) && card > 0 ? { card } : {};
    return result;
  },
  beforeLoad: async ({ context, location }) => {
    try {
      const [session] = await Promise.all([
        context.queryClient.query({ ...q.session(), staleTime: "static" }),
        context.queryClient.query({ ...q.me(), staleTime: "static" }),
      ]);
      preloadShell(context.queryClient);
      rememberSignedIn(true);
      return { session };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        rememberSignedIn(false);
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
