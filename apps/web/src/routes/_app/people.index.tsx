import { createFileRoute } from "@tanstack/react-router";

import { PeopleList } from "#features/people/people";

export const Route = createFileRoute("/_app/people/")({
  head: () => ({ meta: [{ title: "People · Worklog" }] }),
  component: PeopleList,
});
