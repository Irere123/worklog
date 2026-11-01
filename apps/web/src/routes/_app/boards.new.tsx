import { createFileRoute } from "@tanstack/react-router";

import { NewBoard } from "#features/board/new-board";

export const Route = createFileRoute("/_app/boards/new")({
  head: () => ({ meta: [{ title: "New board · Worklog" }] }),
  component: NewBoard,
});
