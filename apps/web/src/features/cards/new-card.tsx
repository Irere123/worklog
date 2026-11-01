import { TicketIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMatch, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { Button } from "#ui/button";
import { Kbd } from "#ui/chip";
import { Input, Select, Switch, Textarea } from "#ui/field";
import { Dialog } from "#ui/overlay";
import { color, leading, space, text } from "#ui/tokens.stylex";

/** New cards always land in Maybe?, so someone decides where they go instead of the form. */
export function NewCardDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const boards = useQuery(q.boards());
  const onBoard = useMatch({
    from: "/_app/boards/$boardId",
    shouldThrow: false,
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [golden, setGolden] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();

  const boardId =
    picked ??
    onBoard?.params.boardId ??
    boards.data?.find((b) => !b.archived)?.id ??
    "";
  const close = () => {
    setPicked(null);
    onClose();
  };

  const create = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/cards", {
          body: {
            boardId,
            title: title.trim(),
            body: body.trim() || undefined,
            golden,
          },
        })
      ),
    onSuccess: (card) => {
      void client.invalidateQueries({ queryKey: ["cards"] });
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
      close();
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = () => {
    if (title.trim() && boardId && !create.isPending) {
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
            disabled={!title.trim() || !boardId}
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
          <Select
            aria-label="Board"
            value={boardId}
            onChange={(e) => setPicked(e.target.value)}
            sx={styles.board}
          >
            {boards.data
              ?.filter((b) => !b.archived)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </Select>
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
  board: { width: 220 },
  golden: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.label,
    color: color.goldFg,
    cursor: "pointer",
  },
  hint: {
    marginInlineEnd: "auto",
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.meta,
    color: color.fgFaint,
  },
});
