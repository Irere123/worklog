import { createFileRoute } from "@tanstack/react-router";

import { Feedback } from "#features/settings/feedback";

export const Route = createFileRoute("/_app/settings/feedback")({
  component: Feedback,
});
