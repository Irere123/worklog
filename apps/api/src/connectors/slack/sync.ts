import { z } from "zod";

import type {
  AccountDetails,
  ConnectionView,
  Source,
  SyncSpec,
} from "#connectors/types";
import type { AppContext } from "#context";

import { botTokenOf, slackApi } from "./api";

const MAX_PAGES = 20;

// Slack sends "" for a missing name or cursor.
const nonEmpty = (s: string | undefined) => (s === "" ? undefined : s);

const Channels = z.object({
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      is_private: z.boolean().optional(),
      is_archived: z.boolean().optional(),
    })
  ),
  response_metadata: z
    .object({ next_cursor: z.string().optional() })
    .optional(),
});

/** Channels the bot can see, for choosing which ones count as work updates. */
export async function slackChannels(
  ctx: AppContext,
  conn: ConnectionView
): Promise<Source[]> {
  const token = botTokenOf(conn.secrets);
  const sources: Source[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = Channels.parse(
      await slackApi(ctx, token, "conversations.list", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      })
    );
    for (const c of body.channels) {
      sources.push({ id: c.id, name: c.name, private: c.is_private === true });
    }
    cursor = nonEmpty(body.response_metadata?.next_cursor);
    if (!cursor) {
      break;
    }
  }
  return sources.toSorted((a, b) => a.name.localeCompare(b.name));
}

const UserInfo = z.object({
  user: z.object({
    name: z.string().optional(),
    real_name: z.string().optional(),
    is_bot: z.boolean().optional(),
    profile: z
      .object({
        email: z.string().optional(),
        display_name: z.string().optional(),
        real_name: z.string().optional(),
        image_72: z.string().optional(),
      })
      .optional(),
  }),
});

export async function slackAccount(
  ctx: AppContext,
  conn: ConnectionView,
  _app: unknown,
  userId: string
): Promise<AccountDetails | null> {
  const body = UserInfo.safeParse(
    await slackApi(
      ctx,
      botTokenOf(conn.secrets),
      "users.info",
      { user: userId },
      // Someone from another organization in a shared channel isn't in this directory.
      { soft: ["user_not_found", "user_not_visible"] }
    )
  );
  // Slack answered without a user: nothing to learn, and asking again won't change that.
  if (!body.success) {
    return null;
  }
  const { user } = body.data;
  return {
    email: user.profile?.email ?? null,
    name: nonEmpty(user.real_name) ?? nonEmpty(user.profile?.real_name) ?? null,
    handle: nonEmpty(user.profile?.display_name) ?? nonEmpty(user.name) ?? null,
    bot: user.is_bot === true,
    avatarUrl: nonEmpty(user.profile?.image_72) ?? null,
  };
}

const Message = z.looseObject({
  ts: z.string(),
  thread_ts: z.string().optional(),
  reply_count: z.number().optional(),
  latest_reply: z.string().optional(),
});

const History = z.object({
  messages: z.array(Message),
  has_more: z.boolean().optional(),
  response_metadata: z
    .object({ next_cursor: z.string().optional() })
    .optional(),
});

const Info = z.object({
  channel: z.object({ is_private: z.boolean().optional() }),
});

const Cursor = z.object({
  /** Messages after this ts are new on the next run. */
  oldest: z.string().optional(),
  /** Paging within the current run. */
  page: z.string().optional(),
  newest: z.string().optional(),
  private: z.boolean().optional(),
  /**
   * Threads seen with replies, by their first message's ts. A thread started before `oldest`
   * isn't in the history any more, so its new replies are only found by asking for it.
   */
  threads: z.array(z.string()).optional(),
});

/** Threads remembered per channel, the most recently started kept. */
const THREADS_KEPT = 200;

const tsOf = (d: Date) => (d.getTime() / 1000).toFixed(6);
const later = (a: string | undefined, b: string) =>
  a && Number(a) > Number(b) ? a : b;

const channelOf = (stream: string) => stream.slice("channel:".length);

/** Threads read per page of history, so one page of busy threads can't spend the rate limit. */
const THREADS_PER_PAGE = 20;
/** Remembered threads re-read per run, newest first. */
const OLDER_THREADS_PER_RUN = 50;

// Replies after `oldest` in these threads, their first messages left out.
async function threadReplies(
  ctx: AppContext,
  token: string,
  channel: string,
  oldest: string,
  threads: string[]
) {
  const replies: z.infer<typeof Message>[] = [];
  for (const ts of threads) {
    const body = History.parse(
      await slackApi(ctx, token, "conversations.replies", {
        channel,
        ts,
        oldest,
        limit: 200,
      })
    );
    replies.push(...body.messages.filter((m) => m.ts !== ts));
  }
  return replies;
}

// Threads on this page with a reply after `oldest`.
function repliedSince(messages: z.infer<typeof Message>[], oldest: string) {
  return messages
    .filter(
      (m) =>
        (m.reply_count ?? 0) > 0 &&
        m.latest_reply !== undefined &&
        Number(m.latest_reply) > Number(oldest)
    )
    .map((m) => m.ts)
    .slice(0, THREADS_PER_PAGE);
}

/** Messages of each work-update channel, and the replies in threads they started. */
export const slackHistory: SyncSpec = {
  available: (conn) => Boolean(conn.secrets.botToken),
  streams: async (_ctx, conn) => {
    const channels = Array.isArray(conn.settings.channels)
      ? conn.settings.channels.filter((c): c is string => typeof c === "string")
      : [];
    return await Promise.resolve(channels.map((c) => `channel:${c}`));
  },
  async read(ctx, conn, _app, stream, raw, window) {
    const token = botTokenOf(conn.secrets);
    const channel = channelOf(stream);
    const cursor = Cursor.parse(raw);
    const isPrivate =
      cursor.private ??
      Info.parse(await slackApi(ctx, token, "conversations.info", { channel }))
        .channel.is_private === true;
    const oldest = cursor.oldest ?? tsOf(window.since);
    const body = History.parse(
      await slackApi(ctx, token, "conversations.history", {
        channel,
        oldest,
        limit: 200,
        cursor: cursor.page,
      })
    );
    let newest = cursor.newest ?? oldest;
    for (const m of body.messages) {
      newest = later(newest, m.ts);
    }
    const next = nonEmpty(body.response_metadata?.next_cursor);
    const more = Boolean(next && body.has_more !== false);
    const started = body.messages
      .filter((m) => (m.reply_count ?? 0) > 0)
      .map((m) => m.ts);
    const seen = new Set(body.messages.map((m) => m.ts));
    // On a run's last page, the remembered threads this run didn't come across.
    const older = more
      ? []
      : (cursor.threads ?? [])
          .filter(
            (ts) => !seen.has(ts) && Number(ts) >= Number(tsOf(window.since))
          )
          .slice(0, OLDER_THREADS_PER_RUN);
    const messages = [
      ...body.messages,
      ...(await threadReplies(ctx, token, channel, oldest, [
        ...repliedSince(body.messages, oldest),
        ...older,
      ])),
    ];
    const threads = [...new Set([...started, ...(cursor.threads ?? [])])]
      .filter((ts) => Number(ts) >= Number(tsOf(window.since)))
      .toSorted((a, b) => Number(b) - Number(a))
      .slice(0, THREADS_KEPT);
    const page =
      messages.length > 0
        ? {
            eventType: "sync.history",
            partition: channel,
            payload: { channel, private: isPrivate, messages },
          }
        : null;
    if (more) {
      return {
        page,
        cursor: { oldest, page: next, newest, private: isPrivate, threads },
        done: false,
      };
    }
    return {
      page,
      cursor: { oldest: newest, private: isPrivate, threads },
      done: true,
    };
  },
};
