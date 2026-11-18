import { createFileRoute, redirect } from "@tanstack/react-router";

import { ApiError } from "#api/client";
import { q } from "#api/queries";
import { DISPLAY_FONT } from "#features/landing/head";
import { Landing } from "#features/landing/landing";

const DESCRIPTION =
  "The open-source logbook for teams of people and agents. GitHub, Slack, Discord and your agents write it as they work; Worklog tells you what needs you and gives everyone an assistant that knows their work.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Worklog · Your team’s logbook" },
      { name: "description", content: DESCRIPTION },
    ],
    links: DISPLAY_FONT,
  }),
  beforeLoad: async ({ context }) => {
    if (import.meta.env.SSR) {
      return;
    }
    try {
      await context.queryClient.query({ ...q.session(), staleTime: "static" });
    } catch (error) {
      if (error instanceof ApiError) {
        return;
      }
      throw error;
    }
    redirect({ to: "/home", throw: true });
  },
  component: Landing,
});
