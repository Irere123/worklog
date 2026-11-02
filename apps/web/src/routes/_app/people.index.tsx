import { createFileRoute } from "@tanstack/react-router";

import { preloadPeople } from "#api/preload";
import { PeopleList } from "#features/people/people";

export const Route = createFileRoute("/_app/people/")({
  head: () => ({ meta: [{ title: "People · Worklog" }] }),
  loader: ({ context }) => preloadPeople(context.queryClient),
  component: PeopleList,
});
