import type { AppContext } from "#context";
import {
  findDigest,
  insertMemory,
  listForgottenSince,
  listActiveMemoryIds,
  listMemories,
  setMemoriesSuperseded,
} from "#db/queries/memories";
import type { MemoryRow } from "#db/queries/memories";
import type { MemoryEvidence, MemoryKind, Visibility } from "#db/schema";
import { transact } from "#db/transact";
import { notFound } from "#lib/errors";
import { generateId } from "#lib/ids";

const MAX_EVIDENCE = 10;
const MAX_QUOTE_CHARS = 500;

export async function addMemory(
  ctx: AppContext,
  input: {
    workspaceId: string;
    memberId: string;
    kind: MemoryKind;
    content: string;
    visibility?: Visibility;
    source: MemoryRow["source"];
    confirmed: boolean;
    evidence?: MemoryEvidence[];
    day?: string | null;
    aliases?: string[];
    expiresAt?: Date | null;
    supersedes?: string[];
  }
) {
  const now = ctx.now();
  const row: MemoryRow = {
    id: generateId(),
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    kind: input.kind,
    content: input.content.trim(),
    aliases: cleanAliases(input.aliases ?? []),
    visibility: input.visibility ?? "team",
    status: "active",
    supersededBy: null,
    day: input.day ?? null,
    source: input.source,
    confirmed: input.confirmed,
    evidence: keptEvidence(input.evidence ?? [], input.visibility ?? "team"),
    expiresAt: input.expiresAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await transact(ctx, async (tx) => {
    await insertMemory(tx.db, row);
    await setMemoriesSuperseded(tx.db, {
      memberId: input.memberId,
      ids: input.supersedes ?? [],
      supersededBy: row.id,
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

type MemoryView = {
  includePrivate: boolean;
  journalDays?: number;
  /** For what's put in front of every conversation, where a wrong guess would spread to all of them. */
  confirmedOnly?: boolean;
};

export async function renderMemory(
  ctx: AppContext,
  memberId: string,
  view: MemoryView
) {
  const memory = await loadMemory(ctx, memberId, view);
  return memory.text;
}

/**
 * Memory as a pass sees it, with the ids of the lines it was shown: a pass may only replace or
 * retire those, so a line it never saw (or a private one, when it reads team memory) stays put.
 */
export async function loadMemory(
  ctx: AppContext,
  memberId: string,
  view: MemoryView
) {
  const { includePrivate, journalDays = 3, confirmedOnly } = view;
  const now = ctx.now();
  const profile = await listMemories(ctx.db, {
    memberId,
    kinds: ["profile"],
    includePrivate,
    confirmedOnly,
    now,
    limit: 40,
  });
  const facts = await listMemories(ctx.db, {
    memberId,
    kinds: ["fact"],
    includePrivate,
    confirmedOnly,
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
  return {
    shown: new Set([...profile, ...facts].map((r) => r.id)),
    text: [
      section("Profile", profile, bullet),
      section("Facts", facts, bullet),
      section("Recent journal", journal, (r) => `### ${r.day}\n${r.content}`),
    ].join("\n\n"),
  };
}

const CHANGES_LIMIT = 20;

export async function memoryPage(
  ctx: AppContext,
  memberId: string,
  includePrivate: boolean
) {
  const digest = await findDigest(ctx.db, {
    memberId,
    visibility: includePrivate ? "private" : "team",
  });
  if (!digest) {
    return await renderMemory(ctx, memberId, {
      includePrivate,
      journalDays: 1,
      confirmedOnly: true,
    });
  }
  const changes = await memoryChanges(
    ctx,
    memberId,
    includePrivate,
    digest.createdAt
  );
  return [
    `_Digest written ${digest.day ?? digest.createdAt.toISOString().slice(0, 10)}; recall has the details and anything newer._\n\n${digest.content}`,
    changes.length
      ? `## Since the digest\nNewer than the digest: where they differ, these hold.\n${changes.map((c) => `- ${c}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * What memory learned and forgot after `since`, one line each. A conversation's page stays as it
 * was taken, so what changes during it reaches the model as these notes in its newest message.
 */
export async function memoryChanges(
  ctx: AppContext,
  memberId: string,
  includePrivate: boolean,
  since: Date
) {
  const [learned, forgotten] = await Promise.all([
    listMemories(ctx.db, {
      memberId,
      includePrivate,
      now: ctx.now(),
      kinds: ["profile", "fact"],
      confirmedOnly: true,
      createdAfter: since,
      limit: CHANGES_LIMIT,
    }),
    listForgottenSince(ctx.db, {
      memberId,
      includePrivate,
      since,
      limit: CHANGES_LIMIT,
    }),
  ]);
  return [
    ...learned.map((r) => `learned: ${r.content}`),
    ...forgotten.map((r) => `no longer true: ${r.content}`),
  ];
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
    confirmed: true,
    supersedes: existing,
  });
}

function keptEvidence(evidence: MemoryEvidence[], visibility: Visibility) {
  return evidence
    .filter((e) => visibility === "private" || e.kind === "activity")
    .map((e) =>
      e.kind === "said" ? { ...e, text: e.text.slice(0, MAX_QUOTE_CHARS) } : e
    )
    .slice(-MAX_EVIDENCE);
}

function bullet(r: MemoryRow) {
  return `- ${r.content}${r.confirmed ? "" : " (unconfirmed)"} [${r.id}]`;
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
