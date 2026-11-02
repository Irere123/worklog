import type { Schemas } from "#api/client";
import { ago, olderThan } from "#lib/time";
import { Badge } from "#ui/chip";
import type { Tone } from "#ui/chip";

export type Run = NonNullable<Schemas["TeamNow"][number]["agent"]>;

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
      <Badge tone={stale ? "neutral" : look.tone}>
        {stale ? `Quiet for ${ago(run.at)}` : look.label(owner)}
      </Badge>{" "}
      {run.title}
    </>
  );
}
