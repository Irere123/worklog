import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Schemas } from "#api/client";
import { q } from "#api/queries";
import { useMe } from "#features/auth/session";
import { useMembers } from "#features/cards/card-bits";
import type { Member } from "#features/cards/card-bits";
import { upcoming } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { color, motion } from "#ui/tokens.stylex";

import { describe } from "./tool-words";

export type Presence = Schemas["AssistantPresence"];
type Working = Presence["working"][number];
type State = Presence["state"];
type RoutineKind = Schemas["Automation"]["kind"];

/** What a glance at the assistant says, and the conversation it's about when there is one. */
export type Glance = { line: string; conversationId: string | null };

/**
 * The member's own assistant and what it's doing. Every caller shares one presence query, which
 * the event stream keeps current.
 */
export function usePresence() {
  const me = useMe();
  const { list, byId } = useMembers();
  const { data } = useQuery(q.presence());
  const agent = list.find(
    (m) => m.agentProvider === "worklog" && m.ownerId === me?.member.id
  );
  const glance = useMemo(
    () => (data ? describePresence(data, byId) : null),
    [data, byId]
  );
  return { agent, presence: data, state: data?.state ?? "idle", glance };
}

/**
 * What the assistant is up to, in the one line a glance has room for. Work comes first, then what
 * it needs from you, then what it finished, then when it next does something on its own.
 */
export function describePresence(
  presence: Presence,
  people: Map<string, Member>,
  now = new Date()
): Glance {
  const [first, ...rest] = presence.working;
  if (first) {
    const more = rest.length > 0 ? ` · and ${rest.length} more` : "";
    return {
      line: `${doing(first, people)}${more}`,
      conversationId: first.kind === "reply" ? first.conversationId : null,
    };
  }
  if (presence.waiting > 0) {
    return {
      line:
        presence.waiting === 1
          ? "Wants your OK on one change"
          : `Wants your OK on ${presence.waiting} changes`,
      conversationId: null,
    };
  }
  const [answered, ...others] = presence.done;
  if (answered && others.length > 0) {
    return {
      line: `Answered ${others.length + 1} things you asked`,
      conversationId: null,
    };
  }
  if (answered) {
    return {
      line: `Answered “${answered.title ?? "your question"}”`,
      conversationId: answered.conversationId,
    };
  }
  return {
    line: presence.next
      ? `Quiet. ${presence.next.name} ${upcoming(presence.next.at, now)}`
      : "Quiet. Ask it anything",
    conversationId: null,
  };
}

/** An answer written after the asker last had the conversation open. */
export function hasUnseenReply(c: {
  repliedAt: string | null;
  seenAt: string | null;
}) {
  return c.repliedAt !== null && (c.seenAt === null || c.repliedAt > c.seenAt);
}

function doing(work: Working, people: Map<string, Member>) {
  switch (work.kind) {
    case "teammate": {
      return "Answering a teammate";
    }
    case "routine": {
      return ROUTINE_WORDS[work.routine] ?? `Running “${work.name}”`;
    }
    case "reply": {
      return work.step
        ? describe(
            {
              kind: "tool",
              tool: work.step.tool,
              input: work.step.input,
              status: "running",
              count: null,
              approvalId: null,
              found: [],
            },
            people
          )
        : "Thinking it through";
    }
    default: {
      return work satisfies never;
    }
  }
}

// A custom routine is named by its owner, so it reads as its name.
const ROUTINE_WORDS: Record<RoutineKind, string | null> = {
  "brief.daily": "Writing your daily brief",
  "brief.weekly": "Writing your weekly brief",
  digest: "Gathering your digest",
  check: "Checking what needs you",
  consolidate: "Tidying what it remembers",
  custom: null,
};

/**
 * The assistant's face, which says how it's doing the way a colleague's would: still when idle,
 * breathing while it works, looking up when it wants your OK. Motion carries the state, so there's
 * no separate light to learn; with reduced motion a ring says "working" instead.
 */
export function AssistantFace({
  agent,
  state,
  size = 16,
}: {
  agent: Member | undefined;
  state: State;
  size?: number;
}) {
  return (
    <span
      {...stylex.props(
        styles.face,
        state === "working" && styles.working,
        state === "waiting" && styles.waiting
      )}
    >
      <Avatar person={agent} size={size} />
    </span>
  );
}

// Transform only, so the compositor runs it without repainting the sidebar every frame.
const breathe = stylex.keyframes({
  "0%, 100%": { transform: "scale(1)" },
  "50%": { transform: "scale(1.12)" },
});

// A small lift and settle every few seconds, like someone glancing up from their desk.
const lookUp = stylex.keyframes({
  "0%, 70%, 100%": { transform: "translateY(0)" },
  "78%": { transform: "translateY(-2px)" },
  "86%": { transform: "translateY(0)" },
  "92%": { transform: "translateY(-1px)" },
});

const styles = stylex.create({
  face: {
    display: "inline-flex",
    // The agent avatar's own corners, so the reduced-motion ring follows its shape.
    borderRadius: "28%",
    transformOrigin: "50% 60%",
    outlineWidth: 1.5,
    outlineStyle: "solid",
    outlineOffset: 1,
    outlineColor: "transparent",
    transitionProperty: "outline-color",
    transitionDuration: motion.slow,
  },
  working: {
    animationName: {
      default: breathe,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "1.6s",
    animationTimingFunction: motion.inOut,
    animationIterationCount: "infinite",
    outlineColor: {
      default: "transparent",
      "@media (prefers-reduced-motion: reduce)": color.accent,
    },
  },
  waiting: {
    animationName: {
      default: lookUp,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "3.2s",
    animationTimingFunction: "ease-out",
    animationIterationCount: "infinite",
  },
});
