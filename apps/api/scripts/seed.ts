// A demo workspace for designing and trying the web app, built through the public API so it
// exercises the same paths real clients do. Run against an empty server:
//   bun run dev            (in another shell)
//   bun run seed           → prints the owner's API key
import process from "node:process";

const BASE = process.env.WORKLOG_URL ?? "http://localhost:4000";
const HOUR = 3_600_000;

type Json = Record<string, unknown>;

async function call<T = Json>(
  token: string | null,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seed calls its own API, whose responses the spec fixes
  return (await res.json()) as T;
}

const ago = (hours: number) =>
  new Date(Date.now() - hours * HOUR).toISOString();

const setup = await call<{
  token: { token: string };
  member: { id: string };
}>(null, "POST", "/v1/setup", {
  workspaceName: "Larkspur Health",
  name: "Ada Chen",
  email: "ada@example.com",
  handle: "ada",
  timezone: "America/New_York",
});
const ada = setup.token.token;
const adaId = setup.member.id;

type Created = { member: { id: string }; token: { token: string } };
async function person(body: Json) {
  const made = await call<Created>(ada, "POST", "/v1/members", {
    issueToken: true,
    ...body,
  });
  return { id: made.member.id, token: made.token.token };
}

const jean = await person({
  kind: "human",
  name: "Jean Miller",
  handle: "jean",
  title: "Backend engineer",
  timezone: "America/New_York",
});
const grace = await person({
  kind: "human",
  name: "Grace Kim",
  handle: "grace",
  title: "Product designer",
  timezone: "America/Los_Angeles",
});
const eric = await person({
  kind: "human",
  name: "Eric Brooks",
  handle: "eric",
  title: "Clinical lead",
  timezone: "America/New_York",
});
const codex = await person({
  kind: "agent",
  name: "Atlas",
  handle: "atlas",
  title: "Coding agent",
  ownerId: adaId,
  agentProvider: "cursor",
});
const scout = await person({
  kind: "agent",
  name: "Scout",
  handle: "scout",
  title: "Triage agent",
  ownerId: jean.id,
  agentProvider: "claude-code",
});

// Illustrated portraits the web app serves (Notionists by Zoish, CC0): demo people get pictures
// without borrowing a real person's face for an invented name.
for (const [handle, token] of [
  ["ada", ada],
  ["jean", jean.token],
  ["grace", grace.token],
  ["eric", eric.token],
] as const) {
  await call(token, "PATCH", "/v1/me", { avatarUrl: `/avatars/${handle}.svg` });
}

type Board = { id: string; columns: { id: string; name: string }[] };
const referrals = await call<Board>(ada, "POST", "/v1/boards", {
  name: "Referrals",
  description: "Moving patients between clinics without losing their story.",
  columns: ["Investigating", "In progress", "Review", "On hold"],
});
const platform = await call<Board>(ada, "POST", "/v1/boards", {
  name: "Platform",
  description:
    "Infrastructure, sync and the things nobody sees until they break.",
  columns: ["Doing", "Verifying"],
});
const COLORS: Record<string, string> = {
  Investigating: "teal",
  "In progress": "blue",
  Review: "amber",
  "On hold": "gray",
  Doing: "blue",
  Verifying: "green",
};
for (const column of [...referrals.columns, ...platform.columns]) {
  await call(ada, "PATCH", `/v1/columns/${column.id}`, {
    color: COLORS[column.name],
  });
}
const col = (board: Board, name: string) =>
  board.columns.find((c) => c.name === name)?.id;

type Card = { number: number };
type Plan = {
  board: Board;
  title: string;
  body?: string;
  by: string;
  column?: string;
  assign?: string[];
  golden?: boolean;
  tags?: string[];
  later?: boolean;
  done?: boolean;
  comments?: [string, string][];
};

const plans: Plan[] = [
  {
    board: referrals,
    title: "Referral form loses attachments on slow connections",
    body: "Uploads over 2G time out after 30s and the form submits without the scan. Seen at Nyamata and Kabgayi.",
    by: eric.token,
    column: "In progress",
    assign: [jean.id],
    golden: true,
    tags: ["bug", "field"],
    comments: [
      [
        jean.token,
        "Reproduced with network throttling. Chunked upload with resume should fix it.",
      ],
      [
        eric.token,
        "Clinics are printing referrals as a workaround, so this is hurting.",
      ],
    ],
  },
  {
    board: referrals,
    title: "Agree on FHIR R4 profile for referral bundles",
    by: ada,
    column: "Review",
    assign: [adaId, eric.id],
    tags: ["standards"],
    comments: [
      [
        eric.token,
        "The state prefers the IPS-aligned profile. Draft is in the shared folder.",
      ],
    ],
  },
  {
    board: referrals,
    title: "Show referral status to the sending clinic",
    body: "Sending nurses can't tell if a referral was received, seen or rejected.",
    by: grace.token,
    column: "In progress",
    assign: [grace.id],
    tags: ["design"],
  },
  {
    board: referrals,
    title: "SMS fallback when the receiving clinic is offline",
    by: jean.token,
    column: "Investigating",
    assign: [codex.id],
    tags: ["sms"],
  },
  {
    board: referrals,
    title: "Duplicate patients after county merge",
    by: eric.token,
    column: "Investigating",
    tags: ["data"],
  },
  {
    board: referrals,
    title: "Spanish copy review for the referral flow",
    by: grace.token,
    column: "On hold",
    assign: [grace.id],
    tags: ["i18n"],
  },
  {
    board: referrals,
    title: "Printable referral summary",
    by: eric.token,
    tags: ["design"],
  },
  {
    board: referrals,
    title: "Track referral turnaround per county",
    by: ada,
    tags: ["reporting"],
  },
  {
    board: referrals,
    title: "Let receiving clinicians reply on a referral",
    by: grace.token,
  },
  {
    board: referrals,
    title: "Offline drafts for referral forms",
    by: jean.token,
    later: true,
  },
  {
    board: referrals,
    title: "Referral audit log export",
    by: ada,
    later: true,
  },
  {
    board: referrals,
    title: "Search referrals by patient ID",
    by: jean.token,
    column: "In progress",
    assign: [jean.id],
    done: true,
  },
  {
    board: referrals,
    title: "Sign-in with hospital SSO",
    by: ada,
    done: true,
  },
  {
    board: platform,
    title: "Nightly sync stalls on the Denver server",
    body: "The job holds a lock for 40 minutes after a network blip. Needs a timeout and a resume point.",
    by: jean.token,
    column: "Doing",
    assign: [jean.id, scout.id],
    golden: true,
    tags: ["ops"],
  },
  {
    board: platform,
    title: "Move backups to the new object store",
    by: ada,
    column: "Verifying",
    assign: [codex.id],
    tags: ["ops"],
  },
  {
    board: platform,
    title: "Upgrade Postgres to 18",
    by: jean.token,
    column: "Doing",
    assign: [codex.id],
  },
  {
    board: platform,
    title: "Alert when a clinic hasn't synced for a day",
    by: eric.token,
  },
  {
    board: platform,
    title: "Rotate the SMS gateway credentials",
    by: ada,
    done: true,
  },
];

const numbers: Record<string, number> = {};
for (const plan of plans) {
  const card = await call<Card>(plan.by, "POST", "/v1/cards", {
    boardId: plan.board.id,
    title: plan.title,
    body: plan.body,
    tags: plan.tags ?? [],
    golden: plan.golden ?? false,
  });
  numbers[plan.title] = card.number;
  const at = `/v1/cards/${card.number}`;
  if (plan.column) {
    await call(plan.by, "POST", `${at}/triage`, {
      columnId: col(plan.board, plan.column),
    });
  }
  for (const memberId of plan.assign ?? []) {
    await call(plan.by, "POST", `${at}/assignments`, { memberId });
  }
  for (const [token, body] of plan.comments ?? []) {
    await call(token, "POST", `${at}/comments`, { body });
  }
  if (plan.later === true) {
    await call(plan.by, "POST", `${at}/not_now`);
  }
  if (plan.done === true) {
    await call(plan.by, "POST", `${at}/closure`);
  }
}
const n = (title: string) => numbers[title];

const logs: [string, Json][] = [
  [
    jean.token,
    {
      text: "Chunked uploads working locally, testing on a throttled 2G profile next",
      kind: "entry",
      cardNumber: n("Referral form loses attachments on slow connections"),
      occurredAt: ago(3),
    },
  ],
  [
    eric.token,
    {
      text: "Decided: referrals rejected for missing info go back to the sender with a reason, never silently",
      kind: "decision",
      occurredAt: ago(20),
    },
  ],
  [
    grace.token,
    {
      text: "Blocked on @ada: need sign-off on the status colours before handing off to Jean",
      kind: "blocker",
      cardNumber: n("Show referral status to the sending clinic"),
      occurredAt: ago(2),
    },
  ],
  [
    jean.token,
    {
      text: "Blocked on @ada — need the production DB credentials rotated before the Postgres upgrade",
      kind: "blocker",
      cardNumber: n("Upgrade Postgres to 18"),
      occurredAt: ago(5),
    },
  ],
  [
    ada,
    {
      text: "Met the state health team: they want turnaround reporting by county before the January review",
      kind: "entry",
      occurredAt: ago(26),
    },
  ],
  [
    grace.token,
    {
      text: "Shipped the new referral status mockups to the team",
      kind: "win",
      occurredAt: ago(28),
    },
  ],
  [
    eric.token,
    {
      text: "Visited Nyamata health centre; three nurses walked me through how they print referrals today",
      kind: "entry",
      occurredAt: ago(50),
    },
  ],
];
for (const [token, body] of logs) {
  await call(token, "POST", "/v1/logs", body);
}

const agentWork: [string, Json][] = [
  [
    codex.token,
    {
      kind: "agent.task",
      title: "Backups copied to the object store; verifying checksums",
      thread: "backups",
      onBehalfOf: "ada",
      state: "working",
      cardNumber: n("Move backups to the new object store"),
      occurredAt: ago(1),
    },
  ],
  [
    codex.token,
    {
      kind: "agent.task",
      title: "Postgres 18 upgrade plan ready — approve the maintenance window?",
      body: "Proposed: Saturday 02:00–03:00 CAT. Rollback is a snapshot restore (~12 min).",
      thread: "pg18",
      onBehalfOf: "ada",
      state: "needs_you",
      cardNumber: n("Upgrade Postgres to 18"),
      occurredAt: ago(0.5),
    },
  ],
  [
    codex.token,
    {
      kind: "agent.task",
      title:
        "SMS fallback prototype: messages queue and send when the clinic is back",
      thread: "sms",
      onBehalfOf: "ada",
      state: "finished",
      cardNumber: n("SMS fallback when the receiving clinic is offline"),
      occurredAt: ago(7),
    },
  ],
  [
    scout.token,
    {
      kind: "agent.task",
      title: "Found the sync stall: lock held across a retry loop",
      thread: "sync",
      onBehalfOf: "jean",
      state: "finished",
      cardNumber: n("Nightly sync stalls on the Denver server"),
      occurredAt: ago(4),
    },
  ],
  [
    scout.token,
    {
      kind: "agent.task",
      title: "Couldn't reproduce duplicate patients on staging data",
      thread: "dupes",
      onBehalfOf: "jean",
      state: "failed",
      cardNumber: n("Duplicate patients after county merge"),
      occurredAt: ago(9),
    },
  ],
];
for (const [token, body] of agentWork) {
  await call(token, "POST", "/v1/activities", body);
}

await call(
  jean.token,
  "POST",
  `/v1/cards/${n("Track referral turnaround per county")}/assignments`,
  { memberId: adaId }
);

for (const memory of [
  {
    content:
      "Prefers short written updates over meetings; reads briefs at 7:30 before clinic rounds.",
    kind: "profile",
  },
  {
    content:
      "The state review is in mid-January; turnaround reporting by county is the headline ask.",
    kind: "fact",
  },
  {
    content: "Eric is the clinical source of truth for referral rules.",
    kind: "fact",
    visibility: "team",
  },
]) {
  await call(ada, "POST", "/v1/memories", memory);
}
await call(ada, "PUT", "/v1/voice", {
  content:
    "Be brief. Lead with what changed and what needs me. Use New York time.",
});
await call(ada, "POST", "/v1/briefs", { period: "daily" });

console.log(`Seeded "Larkspur Health" on ${BASE}.
Owner API key (Ada): ${ada}
Paste it into the web app's sign-in screen, or: export WL="authorization: Bearer ${ada}"`);
