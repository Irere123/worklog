import { createFileRoute } from "@tanstack/react-router";

import { Join } from "#features/auth/join";
import { DISPLAY_FONT } from "#features/landing/head";

export const Route = createFileRoute("/join/$code")({
  head: () => ({
    meta: [{ title: "Join · Worklog" }],
    links: DISPLAY_FONT,
  }),
  ssr: false,
  component: JoinRoute,
});

function JoinRoute() {
  const { code } = Route.useParams();
  return <Join code={code} />;
}
