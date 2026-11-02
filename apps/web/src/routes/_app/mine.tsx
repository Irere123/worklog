import { createFileRoute } from "@tanstack/react-router";

import { preloadMine } from "#api/preload";
import { MyCards } from "#features/cards/my-cards";
import type { MineTab } from "#features/cards/my-cards";

export const Route = createFileRoute("/_app/mine")({
  head: () => ({ meta: [{ title: "My cards · Worklog" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: MineTab } => ({
    tab: search.tab === "added" ? "added" : undefined,
  }),
  loaderDeps: ({ search }) => ({ tab: search.tab ?? "assigned" }),
  loader: ({ context, deps }) => preloadMine(context.queryClient, deps.tab),
  component: MinePage,
});

function MinePage() {
  const tab = Route.useSearch({ select: (s) => s.tab });
  return <MyCards tab={tab ?? "assigned"} />;
}
