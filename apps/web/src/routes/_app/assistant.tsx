import { Outlet, createFileRoute } from "@tanstack/react-router";

import { Conversations } from "#features/assistant/conversations";

export const Route = createFileRoute("/_app/assistant")({
  head: () => ({ meta: [{ title: "Assistant · Worklog" }] }),
  validateSearch: (search: Record<string, unknown>) => {
    const result: { ask?: string } = {
      ask: typeof search.ask === "string" ? search.ask : undefined,
    };
    return result;
  },
  component: AssistantLayout,
});

function AssistantLayout() {
  return (
    <Conversations>
      <Outlet />
    </Conversations>
  );
}
