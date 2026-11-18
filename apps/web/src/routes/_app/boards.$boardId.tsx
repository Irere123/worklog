import {
  ArchiveIcon,
  DotsThreeIcon,
  KanbanIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  TextAlignLeftIcon,
  PlusIcon,
  TimerIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Suspense,
  lazy,
  memo,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { preloadBoard } from "#api/preload";
import { q } from "#api/queries";
import type { paths } from "#api/schema";
import { useMe } from "#features/auth/session";
import { BoardView } from "#features/board/board-view";
import { PromptDialog } from "#features/board/prompt-dialog";
import { NewCardDialog } from "#features/cards/new-card";
import { Button } from "#ui/button";
import { Input, Segmented } from "#ui/field";
import { PageHeader } from "#ui/layout";
import { Menu, MenuItem, MenuSeparator } from "#ui/overlay";

type BoardField = "name" | "description" | "drift";

type BoardEdit = NonNullable<
  paths["/v1/boards/{id}"]["patch"]["requestBody"]
>["content"]["application/json"];

const BoardList = lazy(async () => {
  const { BoardList: list } = await import("#features/board/board-list");
  return { default: list };
});

const StillBoard = memo(BoardView);

const DRIFT_DAYS = [3, 7, 30, 90, 365] as const;

export const Route = createFileRoute("/_app/boards/$boardId")({
  loader: async ({ context, params }) => {
    preloadBoard(context.queryClient, params.boardId);
    return await context.queryClient.query({
      ...q.board(params.boardId),
      staleTime: "static",
    });
  },
  validateSearch: (search: Record<string, unknown>) => {
    const result: { view?: "list" } =
      search.view === "list" ? { view: "list" } : {};
    return result;
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.name ?? "Board"} · Worklog` }],
  }),
  component: BoardPage,
});

function BoardPage() {
  const { boardId } = Route.useParams();
  const board = useQuery(q.board(boardId));
  const me = useMe();
  const [mine, setMine] = useState<"all" | "mine">("all");
  const [textFilter, setTextFilter] = useState("");
  const filterText = useDeferredValue(textFilter);
  const meId = me?.member.id;
  const filter = useMemo(
    () => ({ mine: mine === "mine", text: filterText, meId }),
    [mine, filterText, meId]
  );
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
  const view = Route.useSearch({ select: (s) => s.view });
  const navigate = useNavigate({ from: Route.fullPath });

  if (!board.data) {
    return null;
  }
  return (
    <>
      <PageHeader
        title={board.data.name}
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
                  label: <KanbanIcon size={13} aria-hidden />,
                  name: "Board",
                },
                {
                  value: "list",
                  label: <ListBulletsIcon size={13} aria-hidden />,
                  name: "List",
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
        <Suspense fallback={null}>
          <BoardList board={board.data} filter={filter} />
        </Suspense>
      ) : (
        <StillBoard board={board.data} filter={filter} />
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
          icon={<TextAlignLeftIcon size={14} />}
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
