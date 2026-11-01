import { createFileRoute } from "@tanstack/react-router";

import { ApiKeys } from "#features/settings/people";

export const Route = createFileRoute("/_app/settings/tokens")({
  component: ApiKeys,
});
