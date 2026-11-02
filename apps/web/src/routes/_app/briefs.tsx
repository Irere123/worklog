import { createFileRoute } from "@tanstack/react-router";

import { Briefs } from "#features/briefs/briefs";

export const Route = createFileRoute("/_app/briefs")({
  head: () => ({ meta: [{ title: "Briefs · Worklog" }] }),
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  component: BriefsPage,
});

function BriefsPage() {
  const id = Route.useSearch({ select: (s) => s.id });
  return <Briefs selectedId={id} />;
}
