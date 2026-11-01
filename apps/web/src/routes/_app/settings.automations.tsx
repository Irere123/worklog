import { createFileRoute } from "@tanstack/react-router";

import { Automations } from "#features/settings/automations";

export const Route = createFileRoute("/_app/settings/automations")({
  component: Automations,
});
