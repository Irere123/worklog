import { createFileRoute } from "@tanstack/react-router";

import { preloadHome } from "#api/preload";
import { Home } from "#features/home/home";

export const Route = createFileRoute("/_app/home")({
  head: () => ({ meta: [{ title: "Home · Worklog" }] }),
  loader: ({ context }) => preloadHome(context.queryClient),
  component: Home,
});
