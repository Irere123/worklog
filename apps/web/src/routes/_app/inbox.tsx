import { createFileRoute, useNavigate } from "@tanstack/react-router";

import type { AttentionState } from "#api/queries";
import { Inbox } from "#features/inbox/inbox";

const STATES: readonly AttentionState[] = [
  "open",
  "snoozed",
  "done",
  "dismissed",
];

export const Route = createFileRoute("/_app/inbox")({
  head: () => ({ meta: [{ title: "Inbox · Worklog" }] }),
  validateSearch: (
    search: Record<string, unknown>
  ): { state?: AttentionState; item?: string } => {
    const state = STATES.find((s) => s === search.state);
    const item = typeof search.item === "string" ? search.item : undefined;
    return { ...(state ? { state } : {}), ...(item ? { item } : {}) };
  },
  component: InboxPage,
});

function InboxPage() {
  const { state = "open", item } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <Inbox
      key={item}
      initialItem={item}
      state={state}
      onState={(next) => {
        void navigate({
          search: (prev) => ({
            ...prev,
            state: next === "open" ? undefined : next,
          }),
        });
      }}
    />
  );
}
