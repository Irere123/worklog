import { createFileRoute } from "@tanstack/react-router";

import { DISPLAY_FONT } from "#features/landing/head";
import { PrivacyPage } from "#features/landing/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy · Worklog" },
      {
        name: "description",
        content:
          "What Worklog collects, why, and what you can do about it, in plain words.",
      },
    ],
    links: DISPLAY_FONT,
  }),
  component: PrivacyPage,
});
