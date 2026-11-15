import { createFileRoute } from "@tanstack/react-router";

import { DISPLAY_FONT } from "#features/landing/head";
import { TermsPage } from "#features/landing/legal";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of use · Worklog" },
      {
        name: "description",
        content:
          "The agreement between you and Worklog when you use Worklog Cloud and this website.",
      },
    ],
    links: DISPLAY_FONT,
  }),
  component: TermsPage,
});
