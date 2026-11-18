import type { Schemas } from "#api/client";
import { ago, olderThan } from "#lib/time";
import { Badge } from "#ui/chip";
import type { Tone } from "#ui/chip";
import { Ghost } from "#ui/ghost";
import type { Mood } from "#ui/ghost";

export type Run = Schemas["AgentRun"];

const RUN: Record<
  Run["state"],
  { tone: Tone; label: (owner?: string) => string }
> = {
  working: { tone: "blue", label: () => "Working" },
  needs_you: {
    tone: "amber",
    label: (owner) => (owner ? `Needs ${owner}` : "Needs a person"),
  },
  finished: { tone: "green", label: () => "Finished" },
  failed: { tone: "red", label: () => "Couldn’t finish" },
};

const MOODS: Record<string, Mood> = {
  working: "thinking",
  needs_you: "waiting",
  finished: "done",
  failed: "error",
};

/** How an agent's ghost looks for where its run stands; anything unknown is idle. */
export function runMood(state: string | null | undefined): Mood {
  return MOODS[state ?? ""] ?? "idle";
}

/** A run that's working or waiting on someone; a finished or failed one is history. */
export function inPlay(state: string | null | undefined) {
  return state === "working" || state === "needs_you";
}

/**
 * Where an agent's run stands as a ghost inside a coloured badge. Only runs still in play move:
 * a finished or failed one is history, and a dozen ghosts bobbing down a list is noise.
 */
export function RunBadge({
  state,
  tone,
  children,
}: {
  state: string | null | undefined;
  tone: Tone;
  children: string;
}) {
  const live = inPlay(state);
  return (
    <Badge
      tone={tone}
      icon={<Ghost mood={runMood(state)} size={14} still={!live} tinted />}
    >
      {children}
    </Badge>
  );
}

/**
 * How an agent's face looks for its run, and whether it moves. A run that went quiet is shown as
 * idle and still, the same as the line that says it has stalled.
 */
export function runFace(run: Run | null | undefined): {
  mood: Mood;
  live: boolean;
} {
  if (!run || isStale(run)) {
    return { mood: "idle", live: false };
  }
  return { mood: runMood(run.state), live: inPlay(run.state) };
}

const STALE_MS = 2 * 3_600_000;

/** Who an agent waits on, as the reader says it: "you" for their own agents. */
export function ownerWord(
  owner: { id: string; name: string } | undefined,
  meId: string | undefined
) {
  if (owner !== undefined && owner.id === meId) {
    return "you";
  }
  return owner?.name.split(" ")[0];
}

export function isStale(run: Run) {
  return run.state === "working" && olderThan(run.at, STALE_MS);
}

/** Where an agent's run stands, in words and colour both, then what it said last. */
export function AgentRun({ run, owner }: { run: Run; owner?: string }) {
  const look = RUN[run.state];
  const stale = isStale(run);
  return (
    <>
      <RunBadge
        state={stale ? undefined : run.state}
        tone={stale ? "neutral" : look.tone}
      >
        {stale ? `Quiet for ${ago(run.at)}` : look.label(owner)}
      </RunBadge>{" "}
      {run.title}
    </>
  );
}
