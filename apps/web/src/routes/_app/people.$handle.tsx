import { createFileRoute } from "@tanstack/react-router";

import { preloadPerson } from "#api/preload";
import { Person } from "#features/people/people";

export const Route = createFileRoute("/_app/people/$handle")({
  head: ({ params }) => ({ meta: [{ title: `@${params.handle} · Worklog` }] }),
  loader: ({ context, params }) =>
    preloadPerson(context.queryClient, params.handle),
  component: PersonPage,
});

function PersonPage() {
  const { handle } = Route.useParams();
  return <Person key={handle} handle={handle} />;
}
