import { PaperPlaneRightIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import type { AttentionState } from "#api/queries";
import { useTouch } from "#lib/pointer";
import { Button } from "#ui/button";
import { Kbd } from "#ui/chip";
import { Textarea } from "#ui/field";
import { color, radius, space, text } from "#ui/tokens.stylex";

/**
 * Where a person answers their coding agent's question in words, on an open or snoozed question
 * from an agent. The agent isn't listening live: it reads the answer the next time it checks in,
 * so this sends one answer and settles the question rather than opening a chat.
 */
export function AgentAnswer({
  item,
  from,
  state,
  onSent,
}: {
  item: Schemas["AttentionListItem"];
  from: Schemas["Member"] | undefined;
  state: AttentionState;
  onSent: () => void;
}) {
  const open = state === "open" || state === "snoozed";
  if (item.kind !== "agent.needs_you" || from?.kind !== "agent" || !open) {
    return null;
  }
  return <AnswerForm itemId={item.id} agentName={from.name} onSent={onSent} />;
}

function AnswerForm({
  itemId,
  agentName,
  onSent,
}: {
  itemId: string;
  agentName: string;
  onSent: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const free = useSearch({
    from: "/_app",
    select: (search) => search.card === undefined,
  });
  useHotkey("R", () => input.current?.focus(), { enabled: free });
  const client = useQueryClient();
  const touch = useTouch();
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: async (answer: string) =>
      await unwrap(
        api.POST("/v1/attention/{id}/answer", {
          params: { path: { id: itemId } },
          body: { body: answer },
        })
      ),
    onSuccess: () => {
      toast.success(`Sent to ${agentName}`, {
        description: "It reads your answer the next time it checks in.",
      });
      void client.invalidateQueries({ queryKey: ["attention"] });
      onSent();
    },
    onError: (error) => toast.error(error.message),
  });
  const answer = body.trim();
  const submit = () => {
    if (answer !== "" && !send.isPending) {
      send.mutate(answer);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      {...stylex.props(styles.box)}
    >
      <label htmlFor={id} {...stylex.props(styles.label)}>
        Answer {agentName}
      </label>
      <Textarea
        id={id}
        ref={input}
        rows={3}
        placeholder="Your decision, and anything it should know"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div {...stylex.props(styles.foot)}>
        <p {...stylex.props(styles.hint)}>Only you and {agentName} see it.</p>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          icon={<PaperPlaneRightIcon size={14} />}
          busy={send.isPending}
          disabled={answer === ""}
          trailing={touch ? undefined : <Kbd sx={styles.kbd}>⌘ ↵</Kbd>}
        >
          Send answer
        </Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  box: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.amberSubtle,
  },
  label: { fontSize: text.meta, fontWeight: 600, color: color.amberFg },
  foot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space.sm,
  },
  hint: { fontSize: text.meta, color: color.fgMuted },
  kbd: { marginInlineStart: space.xs },
});
