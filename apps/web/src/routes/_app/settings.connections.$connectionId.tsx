import { createFileRoute } from "@tanstack/react-router";

import { ConnectionDetail } from "#features/settings/connections";

export const Route = createFileRoute(
  "/_app/settings/connections/$connectionId"
)({
  component: ConnectionPage,
});

function ConnectionPage() {
  const { connectionId } = Route.useParams();
  return <ConnectionDetail key={connectionId} id={connectionId} />;
}
