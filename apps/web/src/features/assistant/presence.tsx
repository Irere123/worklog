import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Schemas } from "#api/client";
import { q } from "#api/queries";
import { useMe } from "#features/auth/session";
import { useMembers } from "#features/cards/card-bits";
import type { Member } from "#features/cards/card-bits";
import { upcoming } from "#lib/time";
import { Ghost } from "#ui/ghost";
import type { Mood } from "#ui/ghost";

import { describe } from "./tool-words";

export type Presence = Schemas["AssistantPresence"];
type Working = Presence["working"][number];
type RoutineKind = Schemas["Automation"]["kind"];

/** What a glance at the assistant says, and the conversation it's about when there is one. */
export type Glance = { line: string; conversationId: string | null };

/**
 * One slice of the assistant's presence. The query is shared and the event stream keeps it
 * current; the slice is compared deeply, so a caller re-renders only when its part changes, not
 * on every step the assistant takes. `select` must be a stable function (declared at module level).
 */
export function usePresenceOf<T>(select: (presence: Presence) => T) {
  return useQuery({ ...q.presence(), select }).data;
}

/** The conversations the assistant is answering right now, each with how its ghost looks. */
export function busyConversations(presence: Presence) {
  const busy: Partial<Record<string, Mood>> = {};
  for (const work of presence.working) {
    if (work.kind === "reply") {
      busy[work.conversationId] = moodOfWork(work);
    }
  }
  return busy;
}

/** The routines running right now, by id. */
export function runningRoutines(presence: Presence) {
  return presence.working.flatMap((work) =>
    work.kind === "routine" ? [work.automationId] : []
  );
}

/**
 * The member's own assistant and what it's doing, for the places that show all of it: its face
 * and the line that says what it's up to.
 */
export function usePresence() {
  const me = useMe();
  const { list, byId } = useMembers();
  const { data } = useQuery(q.presence());
  const agent = list.find(
    (m) => m.agentProvider === "worklog" && m.ownerId === me?.member.id
  );
  const zone = me?.member.timezone ?? undefined;
  const glance = useMemo(
    () => (data ? describePresence(data, byId, zone) : null),
    [data, byId, zone]
  );
  return {
    agent,
    presence: data,
    mood: moodOf(data),
    glance,
  };
}

/**
 * What the assistant is up to, in the one line a glance has room for. Work comes first, then what
 * it needs from you, then what it finished, then when it next does something on its own.
 */
export function describePresence(
  presence: Presence,
  people: Map<string, Member>,
  timeZone?: string,
  now = new Date()
) {
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
      ? `Quiet. ${presence.next.name} ${upcoming(presence.next.at, now, timeZone)}`
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
      if (work.step?.tool === WRITING_STEP) {
        return "Writing a reply";
      }
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

const ROUTINE_WORDS: Record<RoutineKind, string | null> = {
  "brief.daily": "Writing your daily brief",
  "brief.weekly": "Writing your weekly brief",
  digest: "Gathering your digest",
  check: "Checking what needs you",
  consolidate: "Tidying what it remembers",
  custom: null,
};

const WRITING_STEP = "writing";

/**
 * How the assistant looks for what presence says: writing once its words flow, thinking while it
 * looks things up or runs a routine, waiting when it needs your OK, pleased with an unread answer.
 */
export function moodOf(presence: Presence | undefined) {
  const state = presence?.state ?? "idle";
  const first = presence?.working[0];
  if (state === "working" && first) {
    return moodOfWork(first);
  }
  const mood: Mood = state === "working" ? "thinking" : state;
  return mood;
}

function moodOfWork(work: Working) {
  const mood: Mood =
    work.kind === "reply" && work.step?.tool === WRITING_STEP
      ? "writing"
      : "thinking";
  return mood;
}

/**
 * The assistant's face, which says how it's doing the way a colleague's would. Motion carries the
 * state, so there's no separate light to learn; a page that knows more than presence (you're
 * typing, the reply failed) passes its own `mood`.
 */
export function AssistantFace({
  mood,
  size = 16,
  label,
}: {
  mood: Mood;
  size?: number;
  label?: string;
}) {
  return <Ghost mood={mood} size={size} label={label} />;
}
