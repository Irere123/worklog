import { z } from "zod";

import { complete, structured } from "#agent/generate";
import {
  addMemory,
  renderMemory,
  retireMemories,
  writeDigest,
  writeJournal,
} from "#agent/memory";
import { prompt, UNTRUSTED_NOTE } from "#agent/prompts";
import type { AppContext } from "#context";
import { listActivities } from "#db/queries/activities";
import type { ActivityRow } from "#db/queries/activities";
import { listOwnerMessages } from "#db/queries/conversations";
import type { Member } from "#db/queries/members";
import { listReconcilable } from "#db/queries/memories";
import type { MemoryRow } from "#db/queries/memories";
import type { Visibility } from "#db/schema";
import { transact } from "#db/transact";
import {
  DAY_MS,
  lastLocalDate,
  localDate,
  startOfLocalDate,
  startOfLocalDay,
} from "#lib/time";

const VISIBILITIES = ["team", "private"] as const;
const SUNDAY = 0;

type Said = { text: string | null; createdAt: Date };

// Every field is required: providers' strict structured-output modes reject optional properties.
const Remembered = {
  content: z.string().describe("One self-contained statement"),
  aliases: z
    .array(z.string())
    .describe(
      "Other words someone might search for: synonyms, @handles, #card numbers"
    ),
  expiresOn: z
    .string()
    .nullable()
    .describe(
      "YYYY-MM-DD after which it no longer holds, for time-bound knowledge; null if it lasts"
    ),
};

// Privacy by construction: team-visible memory is only ever written from team-visible activity;
// private activity, and what the member told their own assistant, produce private memory in a
// separate pass.
const Consolidation = z.object({
  journal: z
    .string()
    .describe(
      "Markdown bullets: what they worked on, decisions, blockers — the day in 3-8 bullets"
    ),
  facts: z
    .array(z.object(Remembered))
    .describe(
      "New durable knowledge worth keeping (decisions and their reasons, ownership, context); empty if none"
    ),
  profile: z
    .array(
      z.object({
        ...Remembered,
        supersedes: z
          .array(z.string())
          .describe("Ids of profile lines this replaces"),
      })
    )
    .describe("New or updated statements about how they work / what they own"),
});

const Reconciliation = z.object({
  rewrites: z.array(
    z.object({
      ...Remembered,
      kind: z.enum(["profile", "fact"]),
      replaces: z
        .array(z.string())
        .describe("Ids of the lines this one merges, generalizes or corrects"),
    })
  ),
  retire: z
    .array(z.string())
    .describe("Ids of lines that are no longer true or not worth keeping"),
});

export async function runConsolidate(
  ctx: AppContext,
  member: Member,
  tz: string
): Promise<{ status: "quiet" | "skipped"; summary: string }> {
  const until = startOfLocalDay(ctx.now(), tz);
  const since = startOfLocalDay(ctx.now(), tz, -1);
  const day = localDate(new Date(since.getTime() + DAY_MS / 2), tz);
  const activity = await listActivities(ctx.db, {
    workspaceId: member.workspaceId,
    privateFor: [member.id],
    actorIds: [member.id],
    since,
    until,
    limit: 200,
  });
  // Without a model there's nothing to extract from chat; the journal comes from activity alone.
  const said = ctx.models
    ? await listOwnerMessages(ctx.db, {
        ownerId: member.id,
        since,
        until,
        limit: 100,
      })
    : [];

  const parts: string[] = [];
  for (const visibility of VISIBILITIES) {
    const items = activity.filter((a) => a.visibility === visibility);
    const words = visibility === "private" ? said : [];
    if (items.length || words.length) {
      parts.push(
        await consolidatePart(ctx, member, {
          day,
          tz,
          visibility,
          items,
          said: words,
        })
      );
    }
  }
  if (weekday(day) === SUNDAY) {
    for (const visibility of VISIBILITIES) {
      const tidied = await reconcile(ctx, member, tz, visibility);
      if (tidied) {
        parts.push(tidied);
      }
    }
  }
  if (!parts.length) {
    return { status: "skipped", summary: `No activity on ${day}` };
  }
  await rebuildDigests(ctx, member, day);
  return { status: "quiet", summary: `${day}: ${parts.join("; ")}` };
}

async function consolidatePart(
  ctx: AppContext,
  member: Member,
  input: {
    day: string;
    tz: string;
    visibility: Visibility;
    items: ActivityRow[];
    said: Said[];
  }
) {
  const { day, tz, visibility, items, said } = input;
  const base = {
    workspaceId: member.workspaceId,
    memberId: member.id,
    visibility,
    source: "agent" as const,
  };
  if (!ctx.models) {
    const journal = items
      .toReversed()
      .map(
        (a) =>
          `- ${a.title}${a.kind.startsWith("log.") && a.body && a.body !== a.title ? ` — ${a.body.slice(0, 200)}` : ""}`
      )
      .join("\n");
    await writeJournal(
      ctx,
      member.workspaceId,
      member.id,
      day,
      journal,
      visibility
    );
    return `${visibility} journal (${items.length} items)`;
  }
  // The team pass never sees private memory either, so nothing private can leak into its outputs.
  const memory = await renderMemory(
    ctx,
    member.id,
    visibility === "private",
    3
  );
  const spoken = said.length
    ? `\n\nWhat ${member.name} told their assistant on ${day}:\n${JSON.stringify(
        said.map((m) => ({
          at: m.createdAt.toISOString(),
          text: m.text?.slice(0, 1000),
        }))
      )}`
    : "";
  const output = await structured(ctx.models, {
    model: "fast",
    instructions: [
      prompt("consolidate", { name: member.name }),
      UNTRUSTED_NOTE,
    ],
    prompt: `Current memory:\n${memory}\n\nActivity on ${day}:\n${JSON.stringify(
      items.map((a) => ({
        at: a.occurredAt.toISOString(),
        kind: a.kind,
        source: a.source,
        title: a.title,
        detail: a.body?.slice(0, 500),
      }))
    )}${spoken}`,
    schema: Consolidation,
    timeout: "background",
  });
  if (output.journal.trim()) {
    await writeJournal(
      ctx,
      member.workspaceId,
      member.id,
      day,
      output.journal,
      visibility
    );
  }
  for (const f of output.facts) {
    await addMemory(ctx, {
      ...base,
      kind: "fact",
      content: f.content,
      aliases: f.aliases,
      expiresAt: expiry(f.expiresOn, tz),
    });
  }
  for (const p of output.profile) {
    await addMemory(ctx, {
      ...base,
      kind: "profile",
      content: p.content,
      aliases: p.aliases,
      expiresAt: expiry(p.expiresOn, tz),
      supersedes: p.supersedes,
    });
  }
  return `${visibility}: journal +${output.facts.length} fact(s) +${output.profile.length} profile`;
}

// Memory only grows night by night; once a week the model rewrites it: merging duplicates, turning
// repeated examples into one trait, dropping what stopped being true. Superseded lines stay as history.
async function reconcile(
  ctx: AppContext,
  member: Member,
  tz: string,
  visibility: Visibility
) {
  if (!ctx.models) {
    return null;
  }
  const rows = await listReconcilable(ctx.db, {
    memberId: member.id,
    visibility,
    now: ctx.now(),
  });
  if (rows.length < 2) {
    return null;
  }
  const output = await structured(ctx.models, {
    model: "fast",
    instructions: [prompt("reconcile", { name: member.name }), UNTRUSTED_NOTE],
    prompt: rows.map((r) => line(r, tz)).join("\n"),
    schema: Reconciliation,
    timeout: "background",
  });
  const known = new Set(rows.map((r) => r.id));
  let merged = 0;
  let retired = 0;
  await transact(ctx, async (tx) => {
    for (const r of output.rewrites) {
      const replaces = r.replaces.filter((id) => known.has(id));
      // A rewrite stands for lines that exist; reconciling never invents knowledge.
      if (replaces.length) {
        await addMemory(tx, {
          workspaceId: member.workspaceId,
          memberId: member.id,
          visibility,
          source: "agent",
          kind: r.kind,
          content: r.content,
          aliases: r.aliases,
          expiresAt: expiry(r.expiresOn, tz),
          supersedes: replaces,
        });
        merged += replaces.length;
      }
    }
    const gone = await retireMemories(
      tx,
      member.id,
      output.retire.filter((id) => known.has(id))
    );
    retired = gone.length;
  });
  return `${visibility}: ${merged} line(s) merged, ${retired} retired`;
}

// The team digest is written from team memory only, so teammate conversations can start with it.
async function rebuildDigests(ctx: AppContext, member: Member, day: string) {
  if (!ctx.models) {
    return;
  }
  for (const visibility of VISIBILITIES) {
    const memory = await renderMemory(
      ctx,
      member.id,
      visibility === "private",
      7
    );
    const { text } = await complete(ctx.models, {
      model: "fast",
      instructions: [
        prompt("memory-page", { name: member.name }),
        UNTRUSTED_NOTE,
      ],
      prompt: memory,
      timeout: "background",
    });
    if (text) {
      await writeDigest(
        ctx,
        member.workspaceId,
        member.id,
        day,
        text,
        visibility
      );
    }
  }
}

function line(r: MemoryRow, tz: string) {
  const until = r.expiresAt ? ` (until ${lastLocalDate(r.expiresAt, tz)})` : "";
  const aliases = r.aliases.length ? ` {${r.aliases.join(", ")}}` : "";
  return `- [${r.id}] ${r.kind}${until}: ${r.content}${aliases}`;
}

// Expires at the end of that local day.
function expiry(expiresOn: string | null, tz: string) {
  return expiresOn ? (startOfLocalDate(expiresOn, tz, 1) ?? null) : null;
}

function weekday(day: string) {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}
