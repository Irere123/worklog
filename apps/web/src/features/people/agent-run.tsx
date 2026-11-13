import type { Schemas } from "#api/client";
import { ago, olderThan } from "#lib/time";
import { Badge } from "#ui/chip";
import type { Status, Tone } from "#ui/chip";

export type Run = NonNullable<Schemas["TeamNow"][number]["agent"]>;

const RUN: Record<
  Run["state"],
  { tone: Tone; status: Status; label: (owner?: string) => string }
> = {
  working: { tone: "blue", status: "working", label: () => "Working" },
  needs_you: {
    tone: "amber",
    status: "needs_you",
    label: (owner) => (owner ? `Needs ${owner}` : "Needs a person"),
  },
  finished: { tone: "green", status: "done", label: () => "Finished" },
  failed: { tone: "red", status: "failed", label: () => "Couldn’t finish" },
};

// An agent that says it's working but hasn't said anything for this long has probably stalled.
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
      <Badge
        tone={stale ? "neutral" : look.tone}
        status={stale ? "waiting" : look.status}
      >
        {stale ? `Quiet for ${ago(run.at)}` : look.label(owner)}
      </Badge>{" "}
      {run.title}
    </>
  );
}
