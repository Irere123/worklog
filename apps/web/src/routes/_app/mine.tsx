import { createFileRoute } from "@tanstack/react-router";

import { MyCards } from "#features/cards/my-cards";
import type { MineTab } from "#features/cards/my-cards";

export const Route = createFileRoute("/_app/mine")({
  head: () => ({ meta: [{ title: "My cards · Worklog" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: MineTab } => ({
    tab: search.tab === "added" ? "added" : undefined,
  }),
  component: MinePage,
});

function MinePage() {
  const { tab } = Route.useSearch();
  return <MyCards tab={tab ?? "assigned"} />;
}
