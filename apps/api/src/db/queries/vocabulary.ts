import { sql } from "drizzle-orm";

import type { DbOrTx } from "#db";
import { boards, cards, members, tags, workspaces } from "#db/schema";

export type Vocabulary = { terms: string[]; cards: string[] };

/**
 * The words a workspace says that a speech model has never heard: its people, boards, tags and
 * repos, plus the titles of the cards in play. One round trip, and bounded, since a big
 * workspace's every tag would only crowd out the names that matter.
 */
export async function listVocabulary(
  db: DbOrTx,
  params: { workspaceId: string; maxTerms: number; maxCards: number }
) {
  const id = params.workspaceId;
  const result = await db.execute<{ kind: "term" | "card"; text: string }>(sql`
    (select 'term' as kind, term as text from (
      select ${members.name} as term from ${members}
        where ${members.workspaceId} = ${id} and ${members.deactivatedAt} is null
      union select ${members.handle} from ${members}
        where ${members.workspaceId} = ${id} and ${members.deactivatedAt} is null
      union select ${workspaces.name} from ${workspaces} where ${workspaces.id} = ${id}
      union select ${boards.name} from ${boards}
        where ${boards.workspaceId} = ${id} and ${boards.archivedAt} is null
      union select ${tags.name} from ${tags} where ${tags.workspaceId} = ${id}
      union select split_part(split_part(${cards.externalKey}, ':', 2), '#', 1) from ${cards}
        where ${cards.workspaceId} = ${id} and ${cards.externalKey} like '%:%#%'
    ) as terms where term <> '' limit ${params.maxTerms})
    union all
    (select 'card', ${cards.title} from ${cards}
      where ${cards.workspaceId} = ${id} and ${cards.closedAt} is null
      order by ${cards.lastActiveAt} desc limit ${params.maxCards})`);
  return {
    terms: result.rows.filter((r) => r.kind === "term").map((r) => r.text),
    cards: result.rows.filter((r) => r.kind === "card").map((r) => r.text),
  };
}
