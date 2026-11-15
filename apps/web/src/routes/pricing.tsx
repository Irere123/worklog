import { createFileRoute } from "@tanstack/react-router";

import { DISPLAY_FONT } from "#features/landing/head";
import { Pricing } from "#features/landing/pricing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing · Worklog" },
      {
        name: "description",
        content:
          "Worklog Cloud is free for a team of three, and $49 a month for the whole team with AI included. Self-hosting is free, with every feature.",
      },
    ],
    links: DISPLAY_FONT,
  }),
  component: Pricing,
});
