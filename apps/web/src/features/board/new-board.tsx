import { KanbanIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { Button } from "#ui/button";
import { EmptyState } from "#ui/feedback";
import { Field, Input } from "#ui/field";
import { Page, PageHeader } from "#ui/layout";
import { space } from "#ui/tokens.stylex";

const STARTER = ["Investigating", "In progress", "Review"];

export function NewBoard() {
  const [name, setName] = useState("");
  const boards = useQuery(q.boards());
  const first = (boards.data?.length ?? 0) === 0;
  const client = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/boards", {
          body: { name: name.trim(), columns: STARTER },
        })
      ),
    onSuccess: (board) => {
      void client.invalidateQueries({ queryKey: ["boards"] });
      void navigate({ to: "/boards/$boardId", params: { boardId: board.id } });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <>
      <PageHeader title="Boards" icon={<KanbanIcon size={16} />} />
      <Page width="narrow">
        <EmptyState
          icon={<KanbanIcon size={20} />}
          title={first ? "Start your first board" : "Start a new board"}
          action={
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) {
                  create.mutate();
                }
              }}
              {...stylex.props(styles.form)}
            >
              <Field
                label="Board name"
                hint="It starts with Investigating, In progress and Review. Change them any time."
              >
                {(id) => (
                  <Input
                    id={id}
                    autoFocus
                    value={name}
                    placeholder="Product"
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant="primary"
                busy={create.isPending}
                disabled={!name.trim()}
              >
                Create board
              </Button>
            </form>
          }
        >
          A board holds cards for one stream of work. New cards wait in Maybe?
          until someone decides where they go, and anything left untouched
          drifts to Not now on its own.
        </EmptyState>
      </Page>
    </>
  );
}

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    width: 320,
    textAlign: "left",
  },
});
