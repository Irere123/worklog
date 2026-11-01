import { createFileRoute } from "@tanstack/react-router";

import { MemoryPage } from "#features/settings/assistant";

export const Route = createFileRoute("/_app/settings/memory")({
  component: MemoryPage,
});
