import type { AppContext } from "#context";
import {
  insertMemory,
  listJournalIds,
  listMemories,
  setMemoriesSuperseded,
} from "#db/queries/memories";
import type { MemoryRow } from "#db/queries/memories";
import type { MemoryKind, Visibility } from "#db/schema";
import { transact } from "#db/transact";
import { notFound } from "#lib/errors";
import { newId } from "#lib/ids";

export async function addMemory(
  ctx: AppContext,
  input: {
    workspaceId: string;
    memberId: string;
    kind: MemoryKind;
    content: string;
    visibility?: Visibility;
    source: MemoryRow["source"];
    day?: string | null;
    supersedes?: string[];
  }
) {
  const now = ctx.now();
  const row: MemoryRow = {
    id: newId("mmr"),
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    kind: input.kind,
    content: input.content.trim(),
    visibility: input.visibility ?? "team",
    status: "active",
    day: input.day ?? null,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  await transact(ctx, async (tx) => {
    await insertMemory(tx.db, row);
    await setMemoriesSuperseded(tx.db, {
      memberId: input.memberId,
      ids: input.supersedes ?? [],
      now,
    });
  });
  return row;
}

export async function writeJournal(
  ctx: AppContext,
  workspaceId: string,
  memberId: string,
  day: string,
  content: string,
  visibility: Visibility
) {
  const existing = await listJournalIds(ctx.db, {
    memberId,
    day,
    visibility,
  });
  return await addMemory(ctx, {
    workspaceId,
    memberId,
    kind: "journal",
    content,
    day,
    visibility,
    source: "agent",
    supersedes: existing,
  });
}

export async function forgetMemory(
  ctx: AppContext,
  memberId: string,
  id: string
) {
  const [row] = await setMemoriesSuperseded(ctx.db, {
    memberId,
    ids: [id],
    now: ctx.now(),
  });
  if (!row) {
    throw notFound("Memory");
  }
  return row;
}

export async function renderMemory(
  ctx: AppContext,
  memberId: string,
  includePrivate: boolean,
  journalDays = 3
) {
  const [profile, facts, journal] = await Promise.all([
    listMemories(ctx.db, {
      memberId,
      kinds: ["profile"],
      includePrivate,
      limit: 40,
    }),
    listMemories(ctx.db, {
      memberId,
      kinds: ["fact"],
      includePrivate,
      limit: 60,
    }),
    listMemories(ctx.db, {
      memberId,
      kinds: ["journal"],
      includePrivate,
      limit: journalDays,
    }),
  ]);
  return [
    section("Profile", profile, (r) => `- ${r.content} [${r.id}]`),
    section("Facts", facts, (r) => `- ${r.content} [${r.id}]`),
    section("Recent journal", journal, (r) => `### ${r.day}\n${r.content}`),
  ].join("\n\n");
}

function section(
  title: string,
  rows: MemoryRow[],
  fmt: (r: MemoryRow) => string
) {
  return rows.length
    ? `## ${title}\n${rows.map(fmt).join("\n")}`
    : `## ${title}\n(nothing yet)`;
}
