import {
  ArrowClockwiseIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { agoPhrase } from "#lib/time";
import { Button } from "#ui/button";
import { Badge } from "#ui/chip";
import { EmptyState, Skeleton } from "#ui/feedback";
import { Segmented } from "#ui/field";
import { Markdown } from "#ui/markdown";
import { color, leading, radius, space, text } from "#ui/tokens.stylex";

import { Card, SettingsPage, settingsStyles } from "./frame";

type Rated = Schemas["RatedReply"];
type Replay = Schemas["Replay"];

/**
 * The replies you rated, and a way to see whether they'd come out better today: replaying asks
 * the same question with your current instructions and memory, and shows both answers.
 */
export function Feedback() {
  const [rating, setRating] = useState<"all" | "helpful" | "unhelpful">(
    "unhelpful"
  );
  const ratings = useQuery(q.ratings());
  const list = (ratings.data ?? []).filter(
    (r) => rating === "all" || r.rating === rating
  );
  return (
    <SettingsPage
      title="Reply feedback"
      description="How you rated the assistant’s replies. Replay one to check whether a change to your instructions or memory fixed it."
      actions={
        <Segmented
          label="Show"
          value={rating}
          onChange={setRating}
          options={[
            { value: "unhelpful", label: "Not helpful" },
            { value: "helpful", label: "Helpful" },
            { value: "all", label: "All" },
          ]}
        />
      }
    >
      {ratings.isPending && <Skeleton lines={4} />}
      {ratings.isSuccess && list.length === 0 && (
        <Card>
          <EmptyState title="Nothing rated yet">
            Rate a reply in a conversation, thumbs up or down, and it lands
            here.
          </EmptyState>
        </Card>
      )}
      {list.map((r) => (
        <RatedCard key={r.id} rated={r} />
      ))}
    </SettingsPage>
  );
}

function RatedCard({ rated }: { rated: Rated }) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const run = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/ratings/{id}/replay", {
          params: { path: { id: rated.id } },
        })
      ),
    onSuccess: setReplay,
    onError: (error) => toast.error(error.message),
  });
  return (
    <Card
      footer={
        <Button
          size="sm"
          icon={<ArrowClockwiseIcon size={13} />}
          busy={run.isPending}
          onClick={() => run.mutate()}
        >
          {replay ? "Replay again" : "Replay with today’s setup"}
        </Button>
      }
    >
      <div {...stylex.props(settingsStyles.pad, styles.body)}>
        <div {...stylex.props(styles.meta)}>
          <Badge
            tone={rated.rating === "helpful" ? "green" : "red"}
            icon={
              rated.rating === "helpful" ? (
                <ThumbsUpIcon size={11} />
              ) : (
                <ThumbsDownIcon size={11} />
              )
            }
          >
            {rated.rating === "helpful" ? "Helpful" : "Not helpful"}
          </Badge>
          <span>rated {agoPhrase(rated.updatedAt)}</span>
        </div>
        {rated.question && (
          <p {...stylex.props(styles.question)}>{rated.question}</p>
        )}
        {rated.note && (
          <p {...stylex.props(styles.note)}>Your note: {rated.note}</p>
        )}
        <div {...stylex.props(replay ? styles.compare : styles.single)}>
          <section {...stylex.props(styles.answer)}>
            <h4 {...stylex.props(styles.label)}>
              {replay ? "Then" : "The reply"}
            </h4>
            <Markdown size="label">
              {rated.reply ?? "_The reply is no longer stored._"}
            </Markdown>
          </section>
          {replay && (
            <section {...stylex.props(styles.answer, styles.now)}>
              <h4 {...stylex.props(styles.label)}>Now</h4>
              <Markdown size="label">{replay.after}</Markdown>
            </section>
          )}
        </div>
      </div>
    </Card>
  );
}

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.md },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    fontSize: text.meta,
    color: color.fgFaint,
  },
  question: { fontSize: text.copy, lineHeight: leading.copy, fontWeight: 500 },
  note: { fontSize: text.meta, color: color.fgMuted },
  single: { display: "block" },
  compare: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 1fr",
      "@media (max-width: 640px)": "1fr",
    },
    gap: space.md,
  },
  answer: {
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
    minWidth: 0,
  },
  now: {
    backgroundColor: color.accentSubtle,
    boxShadow: `inset 0 0 0 1px ${color.accentLine}`,
  },
  label: {
    marginBottom: space.sm,
    fontSize: text.caption,
    fontWeight: 600,
    color: color.fgFaint,
  },
});
