import {
  ArchiveIcon,
  DotsThreeIcon,
  KanbanIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TimerIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import type { paths } from "#api/schema";
import { useMe } from "#features/auth/session";
import { BoardList } from "#features/board/board-list";
import { BoardView } from "#features/board/board-view";
import { PromptDialog } from "#features/board/prompt-dialog";
import { NewCardDialog } from "#features/cards/new-card";
import { Button } from "#ui/button";
import { ErrorNote } from "#ui/feedback";
import { Input, Segmented } from "#ui/field";
import { PageHeader } from "#ui/layout";
import { Menu, MenuItem, MenuSeparator } from "#ui/overlay";

type BoardField = "name" | "description" | "drift";

type BoardEdit = NonNullable<
  paths["/v1/boards/{id}"]["patch"]["requestBody"]
>["content"]["application/json"];

const DRIFT_DAYS = [3, 7, 30, 90, 365] as const;

export const Route = createFileRoute("/_app/boards/$boardId")({
  loader: async ({ context, params }) =>
    await context.queryClient.query({
      ...q.board(params.boardId),
      staleTime: "static",
    }),
  validateSearch: (search: Record<string, unknown>): { view?: "list" } =>
    search.view === "list" ? { view: "list" } : {},
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.name ?? "Board"} · Worklog` }],
  }),
  component: BoardPage,
  errorComponent: ({ error }) => <ErrorNote error={error} />,
});

function BoardPage() {
  const { boardId } = Route.useParams();
  const board = useQuery(q.board(boardId));
  const me = useMe();
  const [mine, setMine] = useState<"all" | "mine">("all");
  const [textFilter, setTextFilter] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);
  useHotkey(
    "F",
    () => {
      filterInput.current?.focus();
      filterInput.current?.select();
    },
    { meta: { name: "Filter the board", group: "Board" } }
  );
  const [adding, setAdding] = useState(false);
  const { view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  if (!board.data) {
    return null;
  }
  return (
    <>
      <PageHeader
        title={board.data.name}
        icon={<KanbanIcon size={16} />}
        subtitle={board.data.description ?? undefined}
        actions={
          <>
            <Input
              ref={filterInput}
              aria-label="Filter cards"
              placeholder="Filter"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              leading={<MagnifyingGlassIcon size={13} />}
              sx={styles.filter}
            />
            <Segmented
              label="View"
              value={view ?? "board"}
              onChange={(next) => {
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    view: next === "list" ? "list" : undefined,
                  }),
                });
              }}
              options={[
                {
                  value: "board",
                  label: <KanbanIcon size={13} aria-label="Board" />,
                },
                {
                  value: "list",
                  label: <ListBulletsIcon size={13} aria-label="List" />,
                },
              ]}
            />
            <Segmented
              label="Whose cards"
              value={mine}
              onChange={setMine}
              options={[
                { value: "all", label: "Everyone" },
                { value: "mine", label: "Mine" },
              ]}
            />
            <Button
              variant="primary"
              size="sm"
              icon={<PlusIcon size={14} />}
              onClick={() => setAdding(true)}
            >
              New card
            </Button>
            <BoardMenu boardId={boardId} />
          </>
        }
      />
      {view === "list" ? (
        <BoardList
          board={board.data}
          filter={{
            mine: mine === "mine",
            text: textFilter,
            meId: me?.member.id,
          }}
        />
      ) : (
        <BoardView
          board={board.data}
          filter={{
            mine: mine === "mine",
            text: textFilter,
            meId: me?.member.id,
          }}
        />
      )}
      <NewCardDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function BoardMenu({ boardId }: { boardId: string }) {
  const board = useQuery(q.board(boardId));
  const client = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<BoardField | null>(null);
  const close = () => setEditing(null);
  const update = useMutation({
    mutationFn: async (body: BoardEdit) =>
      await unwrap(
        api.PATCH("/v1/boards/{id}", {
          params: { path: { id: boardId } },
          body,
        })
      ),
    onSuccess: (_board, body) => {
      void client.invalidateQueries({ queryKey: ["boards"] });
      if (body.archived === true) {
        toast("Board archived");
        void navigate({ to: "/boards" });
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const entropyDays = board.data?.entropyDays ?? null;
  return (
    <>
      <Menu
        align="end"
        trigger={
          <Button
            size="sm"
            variant="ghost"
            aria-label="Board options"
            icon={<DotsThreeIcon size={15} />}
          />
        }
      >
        <MenuItem
          icon={<PencilSimpleIcon size={14} />}
          onClick={() => setEditing("name")}
        >
          Rename…
        </MenuItem>
        <MenuItem
          icon={<PencilSimpleIcon size={14} />}
          onClick={() => setEditing("description")}
        >
          Edit description…
        </MenuItem>
        <MenuItem
          icon={<TimerIcon size={14} />}
          onClick={() => setEditing("drift")}
        >
          Drift after… {entropyDays === null ? "" : `(${entropyDays} days)`}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<ArchiveIcon size={14} />}
          danger
          onClick={() => update.mutate({ archived: true })}
        >
          Archive board
        </MenuItem>
      </Menu>
      <PromptDialog
        open={editing === "name"}
        onClose={close}
        title="Rename board"
        label="Board name"
        initial={board.data?.name ?? ""}
        onSubmit={(value) => {
          const name = value.trim();
          if (name) {
            update.mutate({ name });
          }
        }}
      />
      <PromptDialog
        open={editing === "description"}
        onClose={close}
        title="Edit description"
        label="What is this board for?"
        initial={board.data?.description ?? ""}
        onSubmit={(value) => update.mutate({ description: value.trim() })}
      />
      <PromptDialog
        open={editing === "drift"}
        onClose={close}
        title="Drift after"
        label="Days without activity before a card drifts to Not now"
        initial={entropyDays === null ? "" : String(entropyDays)}
        options={[
          { value: "", label: "Workspace default" },
          ...DRIFT_DAYS.map((d) => ({ value: String(d), label: `${d} days` })),
        ]}
        onSubmit={(value) => {
          const chosen = DRIFT_DAYS.find((d) => String(d) === value);
          update.mutate({ entropyDays: chosen ?? null });
        }}
      />
    </>
  );
}

const styles = stylex.create({
  filter: { width: 180 },
});
