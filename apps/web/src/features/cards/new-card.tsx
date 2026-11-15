import { KanbanIcon, TicketIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMatch, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { STARTER } from "#features/board/new-board";
import { Button } from "#ui/button";
import { Kbd } from "#ui/chip";
import { Input, Select, Switch, Textarea } from "#ui/field";
import { Dialog } from "#ui/overlay";
import { color, leading, media, space, text } from "#ui/tokens.stylex";

/** New cards always land in Maybe?, so someone decides where they go instead of the form. */
export function NewCardDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  /** What the card starts with, when it comes from somewhere: a reply, a log. */
  initial?: { title: string; body?: string };
}) {
  const boards = useQuery(q.boards());
  const onBoard = useMatch({
    from: "/_app/boards/$boardId",
    shouldThrow: false,
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [golden, setGolden] = useState(false);
  const [boardName, setBoardName] = useState("");
  const client = useQueryClient();
  const navigate = useNavigate();

  const live = (boards.data ?? []).filter((b) => !b.archived);
  // A new workspace has no board yet: the first card names one rather than leaving an empty
  // picker and a button that never wakes.
  const firstBoard = boards.isSuccess && live.length === 0;
  const boardId = picked ?? onBoard?.params.boardId ?? live[0]?.id ?? "";
  const ready = Boolean(
    title.trim() && (firstBoard ? boardName.trim() : boardId)
  );
  const close = () => {
    setPicked(null);
    onClose();
  };

  const create = useMutation({
    mutationFn: async () => {
      let target = boardId;
      if (firstBoard) {
        const board = await unwrap(
          api.POST("/v1/boards", {
            body: { name: boardName.trim(), columns: STARTER },
          })
        );
        target = board.id;
      }
      return await unwrap(
        api.POST("/v1/cards", {
          body: {
            boardId: target,
            title: title.trim(),
            body: body.trim() || undefined,
            golden,
          },
        })
      );
    },
    onSuccess: (card) => {
      void client.invalidateQueries({ queryKey: ["cards"] });
      void client.invalidateQueries({ queryKey: ["boards"] });
      toast.success(`Added #${card.number} to Maybe?`, {
        action: {
          label: "Open",
          onClick: () => {
            void navigate({
              to: "/boards/$boardId",
              params: { boardId: card.boardId },
              search: { card: card.number },
            });
          },
        },
      });
      setTitle("");
      setBody("");
      setGolden(false);
      setBoardName("");
      close();
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = () => {
    if (ready && !create.isPending) {
      create.mutate();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          close();
        }
      }}
      title="New card"
      footer={
        <>
          <span {...stylex.props(styles.hint)}>
            <Kbd>⌘ ↵</Kbd> to add
          </span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            busy={create.isPending}
            disabled={!ready}
          >
            Add card
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <Input
          autoFocus
          aria-label="Title"
          placeholder="What needs doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          sx={styles.title}
        />
        <Textarea
          aria-label="Description"
          placeholder="Add context (optional). Markdown works."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          sx={styles.desc}
        />
        <div {...stylex.props(styles.row)}>
          {firstBoard ? (
            <Input
              aria-label="Board name"
              placeholder="Name its board, like Platform"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              sx={styles.board}
            />
          ) : (
            <Select
              label="Board"
              value={boardId}
              onValueChange={setPicked}
              sx={styles.board}
              options={live.map((b) => ({
                value: b.id,
                label: b.name,
                icon: <KanbanIcon size={14} />,
              }))}
            />
          )}
          {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- Switch renders Base UI's hidden checkbox inside this label, which the rule can't see */}
          <label {...stylex.props(styles.golden)}>
            <TicketIcon size={14} />
            Golden ticket
            <Switch
              checked={golden}
              onCheckedChange={setGolden}
              label="Golden ticket"
            />
          </label>
        </div>
      </div>
    </Dialog>
  );
}

const styles = stylex.create({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    paddingInline: space.xl,
    paddingBottom: space.xl,
  },
  title: { height: 40, fontSize: text.copy, fontWeight: 500 },
  desc: { minHeight: 90, lineHeight: leading.label },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  // At a fixed 220px the picker leaves a phone too little room for the golden ticket beside it.
  board: {
    width: { default: 220, "@media (max-width: 640px)": "auto" },
    flexGrow: { default: 0, "@media (max-width: 640px)": 1 },
    minWidth: 0,
  },
  golden: {
    flexShrink: 0,
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.label,
    color: color.goldFg,
    cursor: "pointer",
  },
  // Keyboard hints mean nothing on a touch screen; hidden rather than removed, it still pushes
  // the buttons to the end.
  hint: {
    marginInlineEnd: "auto",
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.meta,
    color: color.fgFaint,
    visibility: {
      default: null,
      [media.touch]: "hidden",
    },
  },
});
