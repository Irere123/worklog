import type { AppContext } from "#context";
import type { Member } from "#db/queries/members";
import { listMemories } from "#db/queries/memories";
import type { MemoryRow } from "#db/queries/memories";
import { getWorkspaceById } from "#db/queries/workspaces";
import { VISIBILITY } from "#db/schema";
import { lastLocalDate, localDate, timezoneOf } from "#lib/time";

const MAX_EXPORTED = 10_000;

export type MemoryFile = { path: string; content: string };

/**
 * What the assistant knows about a member, as Markdown files split by visibility, so `team/` can be
 * shared and `private/` kept back. Lines come in the order they were learned, and nothing depends
 * on when the export ran, so committing every export to git gives a diff of what changed.
 */
export async function exportMemory(
  ctx: AppContext,
  member: Member
): Promise<MemoryFile[]> {
  const tz = timezoneOf(
    member,
    await getWorkspaceById(ctx.db, { id: member.workspaceId })
  );
  const rows = await listMemories(ctx.db, {
    memberId: member.id,
    includePrivate: true,
    now: ctx.now(),
    limit: MAX_EXPORTED,
  });
  const learned = rows.toSorted(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  );
  const files: MemoryFile[] = [];
  for (const visibility of VISIBILITY) {
    const of = (kind: MemoryRow["kind"]) =>
      learned.filter((r) => r.visibility === visibility && r.kind === kind);
    files.push(
      ...bullets(`${visibility}/profile.md`, "Profile", of("profile"), tz),
      ...bullets(`${visibility}/facts.md`, "Facts", of("fact"), tz),
      ...of("digest").map((r) => ({
        path: `${visibility}/digest.md`,
        content: `# Digest\n\n${r.content}\n`,
      })),
      ...of("journal").map((r) => {
        const day = r.day ?? localDate(r.createdAt, tz);
        return {
          path: `${visibility}/journal/${day}.md`,
          content: `# ${day}\n\n${r.content}\n`,
        };
      })
    );
  }
  return files.toSorted((a, b) => a.path.localeCompare(b.path));
}

function bullets(
  path: string,
  title: string,
  rows: MemoryRow[],
  tz: string
): MemoryFile[] {
  if (!rows.length) {
    return [];
  }
  const lines = rows.map(
    (r) => `- ${r.content.replaceAll(/\s+/gu, " ")}${notes(r, tz)} [${r.id}]`
  );
  return [{ path, content: `# ${title}\n\n${lines.join("\n")}\n` }];
}

function notes(r: MemoryRow, tz: string) {
  const parts = [
    r.confirmed ? "" : "unconfirmed",
    r.expiresAt ? `until ${lastLocalDate(r.expiresAt, tz)}` : "",
    r.aliases.length ? `also: ${r.aliases.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? ` (${parts.join("; ")})` : "";
}
