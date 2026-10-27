import type { AppContext } from "#context";
import {
  findDigest,
  insertMemory,
  listActiveMemoryIds,
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
    aliases?: string[];
    expiresAt?: Date | null;
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
    aliases: cleanAliases(input.aliases ?? []),
    visibility: input.visibility ?? "team",
    status: "active",
    day: input.day ?? null,
    source: input.source,
    expiresAt: input.expiresAt ?? null,
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
  return await replaceLatest(ctx, {
    workspaceId,
    memberId,
    kind: "journal",
    content,
    day,
    visibility,
  });
}

// One active digest per visibility: the team one is built from team memory only, so teammate
// conversations can start with it.
export async function writeDigest(
  ctx: AppContext,
  workspaceId: string,
  memberId: string,
  day: string,
  content: string,
  visibility: Visibility
) {
  return await replaceLatest(ctx, {
    workspaceId,
    memberId,
    kind: "digest",
    content,
    visibility,
    day,
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

export async function retireMemories(
  ctx: AppContext,
  memberId: string,
  ids: string[]
) {
  return await setMemoriesSuperseded(ctx.db, {
    memberId,
    ids,
    now: ctx.now(),
  });
}

export async function renderMemory(
  ctx: AppContext,
  memberId: string,
  includePrivate: boolean,
  journalDays = 3
) {
  const now = ctx.now();
  const profile = await listMemories(ctx.db, {
    memberId,
    kinds: ["profile"],
    includePrivate,
    now,
    limit: 40,
  });
  const facts = await listMemories(ctx.db, {
    memberId,
    kinds: ["fact"],
    includePrivate,
    now,
    limit: 60,
  });
  const journal = journalDays
    ? await listMemories(ctx.db, {
        memberId,
        kinds: ["journal"],
        includePrivate,
        now,
        limit: journalDays,
      })
    : [];
  return [
    section("Profile", profile, (r) => `- ${r.content} [${r.id}]`),
    section("Facts", facts, (r) => `- ${r.content} [${r.id}]`),
    section("Recent journal", journal, (r) => `### ${r.day}\n${r.content}`),
  ].join("\n\n");
}

// What a conversation starts with. Owners get the digest built from all their memory, teammates
// the one built from team memory; without a digest yet (a new member, or no AI) it's rendered raw.
export async function memoryPage(
  ctx: AppContext,
  memberId: string,
  includePrivate: boolean
) {
  const digest = await findDigest(ctx.db, {
    memberId,
    visibility: includePrivate ? "private" : "team",
  });
  return digest
    ? `_Digest written ${digest.day ?? digest.createdAt.toISOString().slice(0, 10)}; recall has the details and anything newer._\n\n${digest.content}`
    : await renderMemory(ctx, memberId, includePrivate, 1);
}

async function replaceLatest(
  ctx: AppContext,
  input: {
    workspaceId: string;
    memberId: string;
    kind: "journal" | "digest";
    content: string;
    day: string;
    visibility: Visibility;
  }
) {
  const existing = await listActiveMemoryIds(ctx.db, {
    memberId: input.memberId,
    kind: input.kind,
    visibility: input.visibility,
    day: input.kind === "journal" ? input.day : undefined,
  });
  return await addMemory(ctx, {
    ...input,
    source: "agent",
    supersedes: existing,
  });
}

function cleanAliases(aliases: string[]) {
  return [
    ...new Set(aliases.map((a) => a.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, 12);
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
