import { createFileRoute } from "@tanstack/react-router";

import { Instructions } from "#features/settings/assistant";

export const Route = createFileRoute("/_app/settings/assistant")({
  component: Instructions,
});
