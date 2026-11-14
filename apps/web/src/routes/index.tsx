import newsreaderLatinUrl from "@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2?url";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ApiError } from "#api/client";
import { q } from "#api/queries";
import { Landing } from "#features/landing/landing";

import newsreaderUrl from "@fontsource-variable/newsreader/opsz.css?url";

const DESCRIPTION =
  "Your team’s logbook. GitHub, Slack, Discord and your agents write it as they work; Worklog tells you what needs you and gives everyone an assistant that knows their work.";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Worklog · Your team’s logbook" },
      { name: "description", content: DESCRIPTION },
    ],
    links: [
      {
        rel: "preload",
        href: newsreaderLatinUrl,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous" as const,
      },
      { rel: "stylesheet", href: newsreaderUrl },
    ],
  }),
  // Someone signed in came for the app, not the pitch. The boot script has already asked for the
  // session, so this costs no extra round trip.
  beforeLoad: async ({ context }) => {
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
  component: Front,
});

function Front() {
  const config = useQuery(q.authConfig());
  return <Landing setupOpen={config.data?.setupOpen === true} />;
}
