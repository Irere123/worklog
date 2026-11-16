import { createFileRoute } from "@tanstack/react-router";

import { ApproveAgent } from "#features/connect/approve";
import { DISPLAY_FONT } from "#features/landing/head";

// The OAuth server's consent page: its query is signed, so the page reads it raw.
export const Route = createFileRoute("/connect/")({
  head: () => ({
    meta: [{ title: "Approve an agent · Worklog" }],
    links: DISPLAY_FONT,
  }),
  ssr: false,
  component: ApproveAgent,
});
