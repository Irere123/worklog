import { beforeAll, describe, expect, test } from "bun:test";

import { hmacHex } from "#lib/crypto";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});

const repository = {
  id: 9001,
  full_name: "acme/ledger",
  default_branch: "main",
};
const emma = { login: "emma-gh", id: 101 };
const sam = { login: "sam-gh", id: 202 };
const pr = (updated: string) => ({
  number: 12,
  title: "Idempotent writes",
  html_url: "https://github.com/acme/ledger/pull/12",
  user: emma,
  updated_at: updated,
});

// One afternoon on one PR, as GitHub would send it.
const history: [string, object][] = [
  [
    "pull_request",
    {
      action: "review_requested",
      sender: emma,
      requested_reviewer: sam,
      pull_request: pr("2026-10-26T13:00:00Z"),
    },
  ],
  ...[1, 2, 3, 4].map((i): [string, object] => [
    "push",
    {
      ref: "refs/heads/idempotent",
      after: `sha-${i}`,
      sender: emma,
      commits: [{ id: `c${i}`, message: `step ${i}` }],
      head_commit: { timestamp: `2026-10-26T13:1${i}:00Z` },
    },
  ]),
  ...[1, 2].map((i): [string, object] => [
    "issue_comment",
    {
      action: "created",
      sender: sam,
      issue: { ...pr("2026-10-26T13:30:00Z"), pull_request: {} },
      comment: {
        id: 7000 + i,
        body: `nit ${i}`,
        html_url: "c",
        user: sam,
        created_at: `2026-10-26T13:3${i}:00Z`,
      },
    },
  ]),
  [
    "pull_request_review",
    {
      action: "submitted",
      sender: sam,
      pull_request: pr("2026-10-26T13:40:00Z"),
      review: {
        id: 88,
        state: "approved",
        body: "Ship it",
        html_url: "r",
        user: sam,
        submitted_at: "2026-10-26T13:40:00Z",
      },
    },
  ],
];

// Deterministic shuffles, so a failure can be reproduced.
function shuffled<T>(items: T[], seed: number) {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

async function play(order: [string, object][], seed: number) {
  const owner = await env.workspace();
  const reviewer = await env.teammate(owner.token, "Sam");
  await env.call("POST", "/v1/members/me/identities", {
    token: owner.token,
    body: { provider: "github", externalId: "101" },
  });
  await env.call("POST", `/v1/members/${reviewer.member.id}/identities`, {
    token: reviewer.token,
    body: { provider: "github", externalId: "202" },
  });
  const conn = (
    await env.call("POST", "/v1/connections", {
      token: owner.token,
      body: { provider: "github", secrets: { webhookSecret: "s" } },
    })
  ).body;
  const path = new URL(conn.webhookUrls.webhook).pathname;
  for (const [i, [event, payload]] of order.entries()) {
    const raw = JSON.stringify({ repository, ...payload });
    await env.app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        // Every third delivery is redelivered under a new id, as a sync re-reading it would be.
        "x-github-delivery": `${seed}-${i}`,
        "x-hub-signature-256": `sha256=${hmacHex("s", raw)}`,
      },
      body: raw,
    });
    if (i % 3 === 0) {
      await env.app.request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": event,
          "x-github-delivery": `${seed}-${i}-again`,
          "x-hub-signature-256": `sha256=${hmacHex("s", raw)}`,
        },
        body: raw,
      });
    }
  }
  await env.drain();
  const activities = (
    await env.call("GET", "/v1/activities?source=github", {
      token: owner.token,
    })
  ).body as { kind: string; data: { units?: number }; count: number }[];
  const open = (
    await env.call("GET", "/v1/attention", { token: reviewer.token })
  ).body as { kind: string }[];
  const units = (kind: string) =>
    activities
      .filter((a) => a.kind === kind)
      .reduce((n, a) => n + (a.data.units ?? a.count), 0);
  return {
    commits: units("code.pushed"),
    comments: units("comment.created"),
    reviews: activities.filter((a) => a.kind === "review.submitted").length,
    requests: activities.filter((a) => a.kind === "review.requested").length,
    waitingOnSam: open.filter((a) => a.kind === "review.requested").length,
  };
}

describe("order and repetition don't change the outcome", () => {
  test("any order of one PR's afternoon, with duplicates, ends the same way", async () => {
    const expected = {
      commits: 4,
      comments: 2,
      reviews: 1,
      requests: 1,
      waitingOnSam: 0,
    };
    expect(await play(history, 0)).toEqual(expected);
    for (const seed of [1, 7, 42, 1337]) {
      expect(await play(shuffled(history, seed), seed)).toEqual(expected);
    }
  }, 120_000);
});
