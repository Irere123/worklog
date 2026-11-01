import { createFileRoute } from "@tanstack/react-router";

import { Delivery } from "#features/settings/automations";

export const Route = createFileRoute("/_app/settings/delivery")({
  component: Delivery,
});
