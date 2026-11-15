import { createFileRoute } from "@tanstack/react-router";

import { FaqPage } from "#features/landing/faq-page";
import { DISPLAY_FONT } from "#features/landing/head";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ · Worklog" },
      {
        name: "description",
        content:
          "Plain answers about starting with Worklog, self-hosting it, AI and agents, privacy and pricing.",
      },
    ],
    links: DISPLAY_FONT,
  }),
  component: FaqPage,
});
