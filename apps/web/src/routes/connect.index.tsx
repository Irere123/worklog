import { createFileRoute } from "@tanstack/react-router";

import { ApproveAgent } from "#features/connect/approve";
import { DISPLAY_FONT } from "#features/landing/head";

export const Route = createFileRoute("/connect/")({
  head: () => ({
    meta: [{ title: "Approve an agent · Worklog" }],
    links: DISPLAY_FONT,
  }),
  ssr: false,
  component: ApproveAgent,
});
