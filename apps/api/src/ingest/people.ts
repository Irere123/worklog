import type { ExternalActor, WorklogEvent } from "#connectors/types";
import type { AppContext } from "#context";
import { listMembersByIds } from "#db/queries/members";
import type { Member } from "#db/queries/members";

import { resolveActors } from "./identity";
import type { Resolved, Sighting } from "./identity";

/** `member` is null unless the identity is linked. */
export type Person = {
  resolved: Resolved;
  member: Member | null;
  /** Bots are quiet by default; an account linked to a Worklog agent is a teammate, not bot noise. */
  isBot: boolean;
};

/** Everyone a delivery's events name, by account id. */
export type People = Map<string, Person>;

// `acted`: the account did something in these events, not only got named in them (a mention,
// an assignment): only that counts as seeing it.
function named(events: WorklogEvent[]) {
  const seen = new Map<string, Sighting>();
  const add = (
    actor: ExternalActor | null | undefined,
    at: Date,
    acted = false
  ) => {
    if (!actor) {
      return;
    }
    const entry = seen.get(actor.id);
    if (entry) {
      entry.n += 1;
      entry.acted = entry.acted === true || acted;
      // A mention carries only an id, an author a login and a name: keep what any of them said.
      entry.actor = {
        id: actor.id,
        handle: actor.handle ?? entry.actor.handle,
        name: actor.name ?? entry.actor.name,
        bot: actor.bot ?? entry.actor.bot,
      };
    } else {
      seen.set(actor.id, { actor, at, n: 1, acted });
    }
  };
  for (const e of events) {
    add(e.actor, e.occurredAt, true);
    add(e.agent?.onBehalfOf, e.occurredAt);
    for (const s of e.signals ?? []) {
      add(s.who, e.occurredAt);
    }
    for (const b of e.board ?? []) {
      add(b.type === "assign_card" ? b.who : null, e.occurredAt);
    }
  }
  return seen;
}

/**
 * Resolves everyone a delivery names before its transaction opens. Identity writes commit on
 * their own, so the transaction holds no lock on a person's row: lanes processing the same people
 * in different orders would otherwise deadlock. Each account is resolved once per delivery, however
 * many of its events it appears in.
 */
export async function resolvePeople(
  ctx: AppContext,
  workspaceId: string,
  namespace: string,
  events: WorklogEvent[]
): Promise<People> {
  const resolved = await resolveActors(ctx, workspaceId, namespace, [
    ...named(events).values(),
  ]);
  const memberIds = [
    ...new Set(
      [...resolved.values()].flatMap((r) => (r.memberId ? [r.memberId] : []))
    ),
  ];
  const rows = await listMembersByIds(ctx.db, { ids: memberIds });
  const members = new Map(rows.map((m) => [m.id, m]));
  const people: People = new Map();
  for (const [id, r] of resolved) {
    const member = r.memberId ? (members.get(r.memberId) ?? null) : null;
    people.set(id, {
      resolved: r,
      member,
      isBot: r.isBot && member?.kind !== "agent",
    });
  }
  return people;
}
