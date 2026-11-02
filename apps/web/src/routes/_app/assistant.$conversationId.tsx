import { createFileRoute } from "@tanstack/react-router";

import { ConversationView } from "#features/assistant/conversations";

export const Route = createFileRoute("/_app/assistant/$conversationId")({
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const ask = Route.useSearch({ select: (s) => s.ask });
  return (
    <ConversationView key={conversationId} id={conversationId} ask={ask} />
  );
}
