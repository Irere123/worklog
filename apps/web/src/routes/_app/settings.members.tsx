import { createFileRoute } from "@tanstack/react-router";

import { Members } from "#features/settings/people";

export const Route = createFileRoute("/_app/settings/members")({
  component: Members,
});
