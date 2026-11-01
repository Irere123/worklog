import { createFileRoute, redirect } from "@tanstack/react-router";

import { q } from "#api/queries";
import { NewBoard } from "#features/board/new-board";

export const Route = createFileRoute("/_app/boards/")({
  head: () => ({ meta: [{ title: "Boards · Worklog" }] }),
  beforeLoad: async ({ context }) => {
    const boards = await context.queryClient.query({
      ...q.boards(),
      staleTime: "static",
    });
    const first = boards.find((b) => !b.archived);
    if (first) {
      redirect({
        to: "/boards/$boardId",
        params: { boardId: first.id },
        throw: true,
      });
    }
  },
  component: NewBoard,
});
