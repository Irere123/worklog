import { createFileRoute } from "@tanstack/react-router";

import { ConnectSignIn } from "#features/connect/approve";
import { DISPLAY_FONT } from "#features/landing/head";

// The OAuth server's login page: its query is signed, so the page reads it raw.
export const Route = createFileRoute("/connect/sign-in")({
  head: () => ({
    meta: [{ title: "Connecting · Worklog" }],
    links: DISPLAY_FONT,
  }),
  ssr: false,
  component: ConnectSignIn,
});
