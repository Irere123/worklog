import type { AppContext } from "#context";
import { listMembersByIds } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import type { AgentGrant } from "#work/agents";
import { resolveMember } from "#work/members";

export function firstName(member: Member) {
  return member.name.split(" ")[0] ?? member.name;
}

export async function assigneeOf(
  ctx: AppContext,
  { agent, owner }: AgentGrant,
  ref: string
) {
  if (ref === "mine") {
    return owner.id;
  }
  const member = await resolveMember(ctx, agent, ref);
  return member.id;
}

export async function handlesOf(ctx: AppContext, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id) => id !== null))];
  const people = unique.length
    ? await listMembersByIds(ctx.db, { ids: unique })
    : [];
  return new Map(people.map((p) => [p.id, `@${p.handle}`]));
}

export function handlesIn(handles: Map<string, string>, ids: string[]) {
  return ids.flatMap((id) => handles.get(id) ?? []);
}
