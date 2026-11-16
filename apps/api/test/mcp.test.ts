import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";

import type { ConsoleMailer } from "#lib/mailer";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await testEnv();
});
beforeEach(() => {
  env.reset();
});

const ORIGIN = "https://worklog.test";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "http://127.0.0.1:33418/callback";

// The browser's half of a sign-in, for requests that also carry an API key.
const cookies = new Map<string, string>();

async function signIn(email: string) {
  const mailbox = (env.ctx.mailer as ConsoleMailer).sent;
  const before = mailbox.length;
  await env.app.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, callbackURL: "/" }),
  });
  for (let tries = 0; tries < 100; tries += 1) {
    const mail = mailbox.slice(before).findLast((m) => m.to === email);
    if (mail) {
      const link = new URL(/https?:\/\/\S+/u.exec(mail.text)![0]);
      const verify = await env.app.request(link.pathname + link.search);
      cookies.set(email, verify.headers.get("set-cookie")!.split(";")[0]!);
      return verify.headers.get("set-auth-token")!;
    }
    await Bun.sleep(10);
  }
  throw new Error(`No sign-in link reached ${email}`);
}

/** What an MCP client does on its own: register, as Claude Code does without a metadata document. */
async function register(name: string) {
  const res = await env.app.request("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

/**
 * The browser half of connecting: the client opens the authorize URL, Worklog sends the signed-in
 * person to the approval page, and approving sends the browser back to the client with a code.
 */
async function approve(
  session: string,
  clientId: string,
  opts: { scope?: string; accept?: string; workspace?: string } = {}
) {
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: opts.scope ?? "ingest read write offline_access",
    state: "xyz",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: RESOURCE,
  });
  const auth = { authorization: `Bearer ${session}` };
  const start = await env.app.request(
    `/api/auth/oauth2/authorize?${authorize.toString()}`,
    { headers: auth }
  );
  expect(start.status).toBe(302);
  let next = new URL(start.headers.get("location")!);
  if (next.pathname === "/connect") {
    if (opts.workspace) {
      await env.app.request("/api/auth/update-session", {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/json",
          origin: ORIGIN,
        },
        body: JSON.stringify({ agentWorkspaceId: opts.workspace }),
      });
    }
    const consent = await env.app.request("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        accept: true,
        scope: opts.accept,
        oauth_query: next.search.slice(1),
      }),
    });
    expect(consent.status).toBe(200);
    next = new URL(((await consent.json()) as { url: string }).url);
  }
  expect(`${next.origin}${next.pathname}`).toBe(REDIRECT);
  const token = await env.app.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: next.searchParams.get("code")!,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
  expect(token.status).toBe(200);
  return (await token.json()) as {
    access_token: string;
    refresh_token?: string;
    scope: string;
  };
}

let rpcId = 0;

/** One JSON-RPC call to /mcp, as a 2025-era client makes it. */
async function rpc(token: string, method: string, params: unknown = {}) {
  rpcId += 1;
  const res = await env.app.request("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  });
  const text = await res.text();
  const data = text.startsWith("{")
    ? text
    : (/^data: (?<json>.*)$/mu.exec(text)?.groups?.json ?? "null");
  return {
    status: res.status,
    challenge: res.headers.get("www-authenticate"),
    body: JSON.parse(data) as { result?: any; error?: { message: string } },
  };
}

const initialize = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "claude-code", version: "2.1.0" },
};

async function call(token: string, name: string, args: unknown) {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  const [content] = res.body.result.content as { text: string }[];
  return {
    isError: res.body.result.isError === true,
    text: content!.text,
    value:
      content!.text.startsWith("{") || content!.text.startsWith("[")
        ? JSON.parse(content!.text)
        : content!.text,
  };
}

describe("coding agents over MCP", () => {
  test("an unauthenticated client is pointed at Worklog's sign-in", async () => {
    const res = await env.app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: initialize,
      }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`
    );
    const metadata = await env.app.request(
      "/.well-known/oauth-protected-resource/mcp"
    );
    expect(await metadata.json()).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [`${ORIGIN}/api/auth`],
    });
    const server = await env.app.request(
      "/.well-known/oauth-authorization-server/api/auth"
    );
    expect(await server.json()).toMatchObject({
      registration_endpoint: `${ORIGIN}/api/auth/oauth2/register`,
      client_id_metadata_document_supported: true,
    });
  });

  test("approving a client makes it an agent working for its person, which reports and asks", async () => {
    const ws = await env.workspace("Larkspur", {
      name: "Ada Obi",
      email: "ada@larkspur.test",
    });
    const session = await signIn("ada@larkspur.test");
    const clientId = await register("Claude Code");

    const approval = await env.call(
      "GET",
      `/v1/agent-approval?clientId=${encodeURIComponent(clientId)}`,
      { token: session }
    );
    expect(approval.body.signedInAs).toBe("ada@larkspur.test");
    // The web app may also hold an API key; the OAuth server only sees the session, so must this.
    const approvalPath = `/v1/agent-approval?clientId=${encodeURIComponent(clientId)}`;
    const byKey = await env.call("GET", approvalPath, { token: ws.token });
    expect(byKey.status).toBe(401);
    const both = await env.app.request(approvalPath, {
      headers: {
        authorization: `Bearer ${ws.token}`,
        cookie: cookies.get("ada@larkspur.test")!,
      },
    });
    expect(both.status).toBe(200);
    expect(((await both.json()) as { signedInAs: string }).signedInAs).toBe(
      "ada@larkspur.test"
    );
    expect(approval.body.client).toMatchObject({
      name: "Claude Code",
      provider: "claude-code",
      verifiedHost: null,
    });
    expect(approval.body.workspaces).toEqual([
      { id: ws.workspace.id, name: "Larkspur", agent: null },
    ]);

    const tokens = await approve(session, clientId);
    expect(tokens.refresh_token).toBeTruthy();

    const init = await rpc(tokens.access_token, "initialize", initialize);
    expect(init.status).toBe(200);
    expect(init.body.result.instructions).toContain(
      "the coding agent of Ada Obi"
    );
    const tools = await rpc(tokens.access_token, "tools/list");
    expect(
      (tools.body.result.tools as { name: string }[]).map((t) => t.name)
    ).toEqual([
      "report_progress",
      "check_in",
      "search_cards",
      "get_card",
      "create_card",
      "move_card",
      "comment_on_card",
    ]);

    const asked = await call(tokens.access_token, "report_progress", {
      state: "needs_you",
      title: "Retry the referrals sync on 502s?",
      details: "Option A: three retries. Option B: queue and alert.",
    });
    expect(asked.isError).toBe(false);
    const thread = asked.value.thread as string;

    const team = await env.call("GET", "/v1/members", { token: ws.token });
    const agent = (team.body as any[]).find((m) => m.name === "Claude Code");
    expect(agent).toMatchObject({
      kind: "agent",
      agentProvider: "claude-code",
      ownerId: ws.member.id,
    });
    const inbox = await env.call("GET", "/v1/attention", { token: ws.token });
    expect(
      (inbox.body as any[]).find((i) => i.kind === "agent.needs_you")
    ).toMatchObject({
      title: "Claude Code needs you: Retry the referrals sync on 502s?",
      priority: "high",
    });
    const waiting = await call(tokens.access_token, "check_in", { thread });
    expect(waiting.value.status).toBe("waiting");

    // A second laptop registers its own client, and joins the agent Ada already has.
    const again = await approve(session, await register("Claude Code"));
    await call(again.access_token, "report_progress", {
      state: "working",
      title: "Second machine",
    });
    const after = await env.call("GET", "/v1/members", { token: ws.token });
    expect(
      (after.body as any[]).filter((m) => m.name === "Claude Code")
    ).toHaveLength(1);
  });

  test("a person answers their agent's question in words, which only it and they can read", async () => {
    const ws = await env.workspace("Kivu", {
      name: "Ada Obi",
      email: "ada@kivu.test",
    });
    const tokens = await approve(
      await signIn("ada@kivu.test"),
      await register("Claude Code")
    );
    await rpc(tokens.access_token, "initialize", initialize);
    const asked = await call(tokens.access_token, "report_progress", {
      state: "needs_you",
      title: "How long should refresh tokens last?",
      details: "90 days, or 30?",
    });
    const thread = asked.value.thread as string;
    const question = (
      (await env.call("GET", "/v1/attention", { token: ws.token }))
        .body as any[]
    ).find((i) => i.kind === "agent.needs_you");

    // The agent holds one call open rather than polling, and hears the answer as it lands.
    const started = Date.now();
    const holding = call(tokens.access_token, "check_in", { thread, wait: 20 });
    await Bun.sleep(100);
    const answered = await env.call(
      "POST",
      `/v1/attention/${question.id}/answer`,
      {
        token: ws.token,
        body: { body: "30 days: the security review wants them short." },
      }
    );
    expect(answered.status).toBe(200);
    expect(answered.body.state).toBe("done");

    const heard = await holding;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(heard.value).toMatchObject({
      status: "resolved",
      replies: [
        {
          from: "@ada-obi",
          on: "inbox",
          body: "30 days: the security review wants them short.",
        },
      ],
    });

    // Agents ask for credentials, so the answer stays out of teammates' feeds.
    const jean = await env.teammate(ws.token, "Jean Ndayisaba");
    const seen = await env.call(
      "GET",
      "/v1/activities?kind=question.answered",
      {
        token: jean.token,
      }
    );
    expect(seen.body).toEqual([]);

    // A new question on the same thread starts with no answers, not the last one's.
    await call(tokens.access_token, "report_progress", {
      state: "needs_you",
      title: "And for the mobile app?",
      thread,
    });
    const fresh = await call(tokens.access_token, "check_in", { thread });
    expect(fresh.value).toEqual({
      status: "waiting",
      next: "Not answered yet. check_in with wait: 50 to hold for it.",
    });

    // With no answer, a hold ends when its time does.
    const before = Date.now();
    const unheard = await call(tokens.access_token, "check_in", {
      thread,
      wait: 1,
    });
    expect(unheard.value).toEqual({ status: "waiting" });
    expect(Date.now() - before).toBeGreaterThanOrEqual(900);

    // The same question sent again, as a client's retry would, doesn't reopen it once answered.
    const mobile = (
      (await env.call("GET", "/v1/attention", { token: ws.token }))
        .body as any[]
    ).find((i) => i.kind === "agent.needs_you");
    await env.call("POST", `/v1/attention/${mobile.id}/answer`, {
      token: ws.token,
      body: { body: "Same, 30 days." },
    });
    await call(tokens.access_token, "report_progress", {
      state: "needs_you",
      title: "And for the mobile app?",
      thread,
    });
    const settled = await call(tokens.access_token, "check_in", { thread });
    expect(settled.value).toMatchObject({
      status: "resolved",
      replies: [{ body: "Same, 30 days." }],
    });
  });

  test("an agent's questions stay urgent while few are waiting, and it hears when too many are", async () => {
    const ws = await env.workspace("Rubavu", {
      name: "Eli Mugisha",
      email: "eli@rubavu.test",
    });
    const tokens = await approve(
      await signIn("eli@rubavu.test"),
      await register("Claude Code")
    );
    await rpc(tokens.access_token, "initialize", initialize);
    const ask = async (title: string, thread?: string) =>
      await call(tokens.access_token, "report_progress", {
        state: "needs_you",
        title,
        thread,
      });
    const threads: string[] = [];
    for (const title of ["Which queue?", "Which region?", "Which plan?"]) {
      threads.push((await ask(title)).value.thread as string);
    }
    const queue = threads[0]!;
    type Item = { id: string; kind: string; title: string; priority: string };
    const questions = async () =>
      (
        (await env.call("GET", "/v1/attention", { token: ws.token }))
          .body as Item[]
      ).filter((i) => i.kind === "agent.needs_you");
    // Each blocks the work Eli gave it, so none waits for a digest.
    expect((await questions()).map((q) => q.priority)).toEqual([
      "high",
      "high",
      "high",
    ]);

    const fourth = await ask("Which name?");
    expect(fourth.isError).toBe(true);
    expect(fourth.text).toContain("hasn't answered 3 of your questions");
    expect(fourth.text).toContain(queue);
    // Asking again on a thread already waiting adds nothing to the pile.
    const followUp = await ask("Which queue, given the new limits?", queue);
    expect(followUp.isError).toBe(false);

    const [first] = await questions();
    await env.call("POST", `/v1/attention/${first!.id}/answer`, {
      token: ws.token,
      body: { body: "The default one." },
    });
    const now = await ask("Which name?");
    expect(now.isError).toBe(false);
    expect(
      (await questions()).find((q) => q.title.endsWith("Which name?"))?.priority
    ).toBe("high");
  });

  test("a thread's reports share its card, whichever report names it", async () => {
    const ws = await env.workspace("Musanze", {
      name: "Ana Uwera",
      email: "ana@musanze.test",
    });
    const tokens = await approve(
      await signIn("ana@musanze.test"),
      await register("Claude Code")
    );
    await rpc(tokens.access_token, "initialize", initialize);
    const board = await env.call("POST", "/v1/boards", {
      token: ws.token,
      body: { name: "Product" },
    });
    await env.call("POST", "/v1/cards", {
      token: ws.token,
      body: { boardId: board.body.id, title: "Export invoices" },
    });
    const report = async (args: Record<string, unknown>) =>
      (await call(tokens.access_token, "report_progress", args)).value
        .thread as string;

    // Agents often report before they've looked the card up.
    const thread = await report({ state: "working", title: "Exporting" });
    await report({ state: "needs_you", title: "CSV or PDF?", thread, card: 1 });
    await report({ state: "finished", title: "Exported as CSV", thread });

    const onCard = await env.call("GET", "/v1/activities?card=1", {
      token: ws.token,
    });
    expect(
      (onCard.body as any[])
        .filter((a) => a.agentState !== null)
        .map((a) => [a.agentState, a.cardNumber])
    ).toEqual([
      ["finished", 1],
      ["needs_you", 1],
      ["working", 1],
    ]);
    // The thread's one inbox item, now saying it's finished, opens on the card too.
    const [item] = (await env.call("GET", "/v1/attention", { token: ws.token }))
      .body as any[];
    expect(item).toMatchObject({ kind: "agent.finished", cardNumber: 1 });
  });

  test("an agent on two cards at once shows on both, and is back at work once answered", async () => {
    const ws = await env.workspace("Nyanza", {
      name: "Ivy Kamanzi",
      email: "ivy@nyanza.test",
    });
    const tokens = await approve(
      await signIn("ivy@nyanza.test"),
      await register("Claude Code")
    );
    await rpc(tokens.access_token, "initialize", initialize);
    const board = await env.call("POST", "/v1/boards", {
      token: ws.token,
      body: { name: "Product" },
    });
    for (const title of ["Export invoices", "Rotate keys"]) {
      await env.call("POST", "/v1/cards", {
        token: ws.token,
        body: { boardId: board.body.id, title },
      });
    }
    const report = async (args: Record<string, unknown>) =>
      (await call(tokens.access_token, "report_progress", args)).value
        .thread as string;
    // Two sessions of one tool are one agent.
    const exporting = await report({
      state: "working",
      title: "Exporting",
      card: 1,
    });
    await report({ state: "needs_you", title: "Rotate now?", card: 2 });
    const runs = async () => {
      const rows = (await env.call("GET", "/v1/now", { token: ws.token }))
        .body as any[];
      const agent = rows.find((r) => r.runs.length > 0);
      return {
        headline: [agent.agent.state, agent.agent.cardNumber],
        cards: (agent.runs as any[]).map((r) => [r.state, r.cardNumber]),
      };
    };
    expect(await runs()).toEqual({
      headline: ["needs_you", 2],
      cards: [
        ["needs_you", 2],
        ["working", 1],
      ],
    });

    const [question] = (
      await env.call("GET", "/v1/attention", { token: ws.token })
    ).body as any[];
    await env.call("POST", `/v1/attention/${question.id}/answer`, {
      token: ws.token,
      body: { body: "Yes, tonight." },
    });
    expect((await runs()).cards).toEqual([
      ["working", 2],
      ["working", 1],
    ]);

    await report({ state: "finished", title: "Exported", thread: exporting });
    expect((await runs()).cards).toEqual([["working", 2]]);
  });

  test("a looping agent runs out of writes before it floods the feed", async () => {
    await env.workspace("Huye", { name: "Uwa", email: "uwa@huye.test" });
    const tokens = await approve(
      await signIn("uwa@huye.test"),
      await register("Claude Code")
    );
    await rpc(tokens.access_token, "initialize", initialize);
    const start = Date.now();
    env.ctx.now = () => new Date(start);
    const report = async (n: number) =>
      await call(tokens.access_token, "report_progress", {
        state: "working",
        title: `Step ${n}`,
      });
    for (let n = 1; n <= 60; n += 1) {
      expect((await report(n)).isError).toBe(false);
    }
    const refused = await report(61);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Try again in 2s");
    env.ctx.now = () => new Date(start + 2000);
    expect((await report(61)).isError).toBe(false);
  });

  test("only an agent's question takes a written answer", async () => {
    const ws = await env.workspace();
    const sam = await env.teammate(ws.token, "Sam");
    const board = await env.call("POST", "/v1/boards", {
      token: ws.token,
      body: { name: "Product" },
    });
    await env.call("POST", "/v1/cards", {
      token: ws.token,
      body: {
        boardId: board.body.id,
        title: "Payments retry",
        assigneeIds: [sam.member.id],
      },
    });
    const [assigned] = (
      await env.call("GET", "/v1/attention", { token: sam.token })
    ).body as any[];
    expect(assigned.kind).toBe("card.assigned");
    const refused = await env.call(
      "POST",
      `/v1/attention/${assigned.id}/answer`,
      { token: sam.token, body: { body: "On it" } }
    );
    expect(refused.status).toBe(400);
  });

  test("replies stay small: no padding, no empty fields, and long reads stop with a pointer", async () => {
    const ws = await env.workspace("Tana", {
      name: "Ines Uwase",
      email: "ines@tana.test",
    });
    const tokens = await approve(
      await signIn("ines@tana.test"),
      await register("Claude Code")
    );
    await rpc(tokens.access_token, "initialize", initialize);
    const board = await env.call("POST", "/v1/boards", {
      token: ws.token,
      body: { name: "Product" },
    });
    for (let i = 1; i <= 21; i += 1) {
      await env.call("POST", "/v1/cards", {
        token: ws.token,
        body: { boardId: board.body.id, title: `Task ${i}` },
      });
    }
    for (let i = 1; i <= 21; i += 1) {
      await env.call("POST", "/v1/cards/1/comments", {
        token: ws.token,
        body: { body: `Note ${i}` },
      });
    }

    const found = await call(tokens.access_token, "search_cards", {});
    expect(found.text).not.toContain("\n");
    expect(found.value.cards).toHaveLength(20);
    expect(found.value.more).toContain("narrow");
    const [first] = found.value.cards;
    expect(Object.keys(first).toSorted()).toEqual([
      "card",
      "lastActiveAt",
      "stage",
      "title",
    ]);
    expect(first.lastActiveAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/u);

    const card = await call(tokens.access_token, "get_card", { card: 1 });
    expect(card.value.earlierComments).toBe(true);
    expect(card.value.comments).toHaveLength(20);
    expect(card.value.comments.at(-1)).toMatchObject({
      from: "@ines-uwase",
      body: "Note 21",
    });

    const working = await call(tokens.access_token, "report_progress", {
      state: "working",
      title: "Task 1",
      card: 1,
    });
    expect(Object.keys(working.value)).toEqual(["thread"]);
    const commented = await call(tokens.access_token, "comment_on_card", {
      number: 1,
      body: "Picking this up",
    });
    expect(commented.value).toBe("Done.");
    const moved = await call(tokens.access_token, "move_card", {
      number: 1,
      to: "Nowhere",
    });
    expect(moved.isError).toBe(true);
    expect(moved.value).toContain('No column named "Nowhere"');
  });

  test("a report-only approval lists only the reporting tools", async () => {
    await env.workspace("Quiet", { name: "Bo", email: "bo@quiet.test" });
    const session = await signIn("bo@quiet.test");
    const tokens = await approve(session, await register("Cursor"), {
      accept: "ingest offline_access",
    });
    expect(tokens.scope.split(" ").toSorted()).toEqual([
      "ingest",
      "offline_access",
    ]);
    const tools = await rpc(tokens.access_token, "tools/list");
    expect(
      (tools.body.result.tools as { name: string }[]).map((t) => t.name)
    ).toEqual(["report_progress", "check_in"]);
  });

  test("disconnecting ends its access until its person approves it again", async () => {
    const ws = await env.workspace("Gone", {
      name: "Cy",
      email: "cy@gone.test",
    });
    const session = await signIn("cy@gone.test");
    const clientId = await register("Codex");
    const first = await approve(session, clientId);
    await rpc(first.access_token, "initialize", initialize);
    const connected = await env.call("GET", "/v1/agent-connections", {
      token: ws.token,
    });
    const [{ agent }] = connected.body as [{ agent: any }];
    expect(agent.agentProvider).toBe("codex");

    const off = await env.call("POST", `/v1/members/${agent.id}/disconnect`, {
      token: ws.token,
    });
    expect(off.status).toBe(200);
    const refused = await rpc(first.access_token, "tools/list");
    expect(refused.status).toBe(401);
    expect(refused.challenge).toContain('error="invalid_token"');
    const refresh = await env.app.request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: first.refresh_token!,
        client_id: clientId,
      }),
    });
    expect(refresh.status).toBe(400);

    // Approving again (the consent was revoked, so Cy is asked) brings the same agent back.
    await Bun.sleep(1100);
    const second = await approve(session, clientId);
    const back = await rpc(second.access_token, "tools/list");
    expect(back.status).toBe(200);
    const listed = await env.call("GET", "/v1/agent-connections", {
      token: ws.token,
    });
    expect((listed.body as any[]).map((c) => c.agent.id)).toEqual([agent.id]);
  });

  test("a person in two workspaces picks which one the agent joins", async () => {
    const one = await env.workspace("One", {
      name: "Di",
      email: "di@two.test",
    });
    const twoRes = await env.call("POST", "/v1/members", {
      token: (
        await env.workspace("Two", { name: "Owner", email: "o@two.test" })
      ).token,
      body: { kind: "human", name: "Di", email: "di@two.test" },
    });
    expect(twoRes.status).toBe(201);
    const session = await signIn("di@two.test");
    const tokens = await approve(session, await register("Claude Code"), {
      workspace: one.workspace.id,
    });
    await call(tokens.access_token, "report_progress", {
      state: "working",
      title: "In the first workspace",
    });
    const team = await env.call("GET", "/v1/members", { token: one.token });
    expect((team.body as any[]).some((m) => m.name === "Claude Code")).toBe(
      true
    );
  });
});
