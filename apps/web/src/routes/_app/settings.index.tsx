import { createFileRoute } from "@tanstack/react-router";

import { Profile } from "#features/settings/profile";

export const Route = createFileRoute("/_app/settings/")({
  component: Profile,
});
