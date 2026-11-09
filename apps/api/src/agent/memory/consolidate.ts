import { z } from "zod";

import { complete, structured } from "#agent/generate";
import {
  addMemory,
  loadMemory,
  renderMemory,
  retireMemories,
  writeDigest,
  writeJournal,
} from "#agent/memory";
import { prompt, UNTRUSTED_NOTE } from "#agent/prompts";
import type { AppContext } from "#context";
import { listActivities, listActivitiesByIds } from "#db/queries/activities";
import type { ActivityRow } from "#db/queries/activities";
import { listOwnerMessages } from "#db/queries/conversations";
import type { Member } from "#db/queries/members";
import { listReconcilable, setMemoriesConfirmed } from "#db/queries/memories";
import type { MemoryRow } from "#db/queries/memories";
import type { MemoryEvidence, Visibility } from "#db/schema";
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

type Said = { id: string; text: string | null; createdAt: Date };

const EVIDENCE_SHOWN = 3;
const EVIDENCE_CHARS = 300;

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
  confirmed: z
    .boolean()
    .describe(
      "True if their own words or activity state it outright; false if you're inferring it"
    ),
};

const Cited = {
  evidence: z
    .array(z.string())
    .describe("Ids of the activity entries and messages above that show it"),
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
    .array(
      z.object({
        ...Remembered,
        ...Cited,
        supersedes: z
          .array(z.string())
          .describe("Ids of facts this corrects or replaces"),
      })
    )
    .describe(
      "Durable knowledge the activity itself can't show (why, who owns what, what was decided); empty if none"
    ),
  profile: z
    .array(
      z.object({
        ...Remembered,
        ...Cited,
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
  confirm: z
    .array(z.string())
    .describe("Ids of unconfirmed lines that their evidence states outright"),
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
  // The team pass never sees private memory either, so nothing private can leak into its outputs,
  // and it can only replace lines it was shown.
  const memory = await loadMemory(ctx, member.id, {
    includePrivate: visibility === "private",
  });
  const spoken = said.length
    ? `\n\nWhat ${member.name} told their assistant on ${day}:\n${JSON.stringify(
        said.map((m) => ({
          id: m.id,
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
    prompt: `Current memory:\n${memory.text}\n\nActivity on ${day}:\n${JSON.stringify(
      items.map((a) => ({
        id: a.id,
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
  const cite = citer(items, said);
  for (const [kind, lines] of [
    ["fact", output.facts],
    ["profile", output.profile],
  ] as const) {
    for (const l of lines) {
      await addMemory(ctx, {
        ...base,
        kind,
        content: l.content,
        aliases: l.aliases,
        confirmed: l.confirmed,
        evidence: cite(l.evidence),
        expiresAt: expiry(l.expiresOn, tz),
        supersedes: l.supersedes.filter((id) => memory.shown.has(id)),
      });
    }
  }
  return `${visibility}: journal +${output.facts.length} fact(s) +${output.profile.length} profile`;
}

// Memory only grows night by night; once a week the model rewrites it: merging duplicates, turning
// repeated examples into one trait, dropping what stopped being true. Each line comes with the
// record it was learned from, so a line that misread its source is corrected against the source
// rather than trusted because it was written down. Superseded lines stay as history.
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
  const records = await listActivitiesByIds(ctx.db, {
    workspaceId: member.workspaceId,
    ids: rows.flatMap((r) =>
      r.evidence.flatMap((e) => (e.kind === "activity" ? [e.id] : []))
    ),
    privateFor: visibility === "private" ? [member.id] : [],
  });
  const activity = new Map(records.map((a) => [a.id, a]));
  const output = await structured(ctx.models, {
    model: "fast",
    instructions: [prompt("reconcile", { name: member.name }), UNTRUSTED_NOTE],
    prompt: rows
      .map((r) => withEvidence(r, tz, visibility, activity))
      .join("\n"),
    schema: Reconciliation,
    timeout: "background",
  });
  const known = new Map(rows.map((r) => [r.id, r]));
  let merged = 0;
  let retired = 0;
  let confirmed = 0;
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
          confirmed: r.confirmed,
          evidence: replaces.flatMap((id) => known.get(id)?.evidence ?? []),
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
    const checked = await setMemoriesConfirmed(tx.db, {
      memberId: member.id,
      ids: output.confirm.filter((id) => known.has(id)),
      now: tx.now(),
    });
    confirmed = checked.length;
  });
  return `${visibility}: ${merged} line(s) merged, ${retired} retired, ${confirmed} confirmed`;
}

// The team digest is written from team memory only, so teammate conversations can start with it.
async function rebuildDigests(ctx: AppContext, member: Member, day: string) {
  if (!ctx.models) {
    return;
  }
  for (const visibility of VISIBILITIES) {
    const memory = await renderMemory(ctx, member.id, {
      includePrivate: visibility === "private",
      journalDays: 7,
      confirmedOnly: true,
    });
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

// The team pass reads only the activity a line cites: what the owner told their own assistant never
// reaches a model writing team memory.
function withEvidence(
  r: MemoryRow,
  tz: string,
  visibility: Visibility,
  activity: Map<string, ActivityRow>
) {
  const until = r.expiresAt ? ` (until ${lastLocalDate(r.expiresAt, tz)})` : "";
  const aliases = r.aliases.length ? ` {${r.aliases.join(", ")}}` : "";
  const status = r.confirmed ? "" : " (unconfirmed)";
  const evidence = r.evidence
    .filter((e) => visibility === "private" || e.kind === "activity")
    .slice(-EVIDENCE_SHOWN)
    .map((e) => `\n  - ${evidenceLine(e, activity, tz)}`)
    .join("");
  return `- [${r.id}] ${r.kind}${status}${until}: ${r.content}${aliases}${evidence}`;
}

function evidenceLine(
  e: MemoryEvidence,
  activity: Map<string, ActivityRow>,
  tz: string
) {
  if (e.kind === "said") {
    return `they said (${localDate(new Date(e.at), tz)}): ${JSON.stringify(e.text.slice(0, EVIDENCE_CHARS))}`;
  }
  const a = activity.get(e.id);
  if (!a) {
    return "activity no longer in the record";
  }
  const detail = a.body && a.body !== a.title ? ` — ${a.body}` : "";
  return `activity (${localDate(a.occurredAt, tz)}, ${a.source}): ${JSON.stringify(`${a.title}${detail}`.slice(0, EVIDENCE_CHARS))}`;
}

// A pass may cite only what it was shown; what the owner said is quoted, since a quote outlives
// the conversation it came from.
function citer(items: ActivityRow[], said: Said[]) {
  const activity = new Set(items.map((a) => a.id));
  const messages = new Map(said.map((m) => [m.id, m]));
  return (ids: string[]): MemoryEvidence[] =>
    [...new Set(ids)].flatMap((id): MemoryEvidence[] => {
      if (activity.has(id)) {
        return [{ kind: "activity", id }];
      }
      const m = messages.get(id);
      return m?.text
        ? [{ kind: "said", at: m.createdAt.toISOString(), text: m.text }]
        : [];
    });
}

// Expires at the end of that local day.
function expiry(expiresOn: string | null, tz: string) {
  return expiresOn ? (startOfLocalDate(expiresOn, tz, 1) ?? null) : null;
}

function weekday(day: string) {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}
