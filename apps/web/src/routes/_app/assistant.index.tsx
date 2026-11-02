import { createFileRoute } from "@tanstack/react-router";

import { NewChat } from "#features/assistant/conversations";

export const Route = createFileRoute("/_app/assistant/")({
  component: NewChatPage,
});

function NewChatPage() {
  const ask = Route.useSearch({ select: (s) => s.ask });
  return <NewChat ask={ask} />;
}
