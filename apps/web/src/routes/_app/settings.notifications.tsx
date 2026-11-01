import { createFileRoute } from "@tanstack/react-router";

import { Notifications } from "#features/settings/profile";

export const Route = createFileRoute("/_app/settings/notifications")({
  component: Notifications,
});
