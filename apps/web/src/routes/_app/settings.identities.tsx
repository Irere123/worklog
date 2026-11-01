import { createFileRoute } from "@tanstack/react-router";

import { Identities } from "#features/settings/identities";

export const Route = createFileRoute("/_app/settings/identities")({
  component: Identities,
});
