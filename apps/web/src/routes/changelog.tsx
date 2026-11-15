import { createFileRoute } from "@tanstack/react-router";

import { Changelog } from "#features/landing/changelog";
import { DISPLAY_FONT } from "#features/landing/head";

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "Changelog · Worklog" },
      {
        name: "description",
        content: "What shipped in Worklog, and why it matters.",
      },
    ],
    links: DISPLAY_FONT,
  }),
  component: Changelog,
});
