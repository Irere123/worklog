import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { api, unwrap, unwrapEarly } from "./client";
import type { paths } from "./schema";

type Query<P extends keyof paths> = paths[P] extends {
  get: { parameters: { query?: infer Q } };
}
  ? NonNullable<Q>
  : never;

export type CardFilter = Query<"/v1/cards">;
export type ActivityFilter = Query<"/v1/activities">;
export type AttentionState = NonNullable<Query<"/v1/attention">["state"]>;

const FEED_PAGE = 50;

// Keys are arrays rooted at the resource name, so the live stream can invalidate a whole family
// (every card list, whatever its filter) with one prefix.
export const q = {
  authConfig: () =>
    queryOptions({
      queryKey: ["auth-config"],
      queryFn: async () => await unwrap(api.GET("/v1/auth/config")),
      staleTime: Number.POSITIVE_INFINITY,
    }),
  session: () =>
    queryOptions({
      queryKey: ["session"],
      queryFn: async () =>
        await unwrapEarly(
          "/v1/session",
          async () => await api.GET("/v1/session")
        ),
      staleTime: 5 * 60_000,
      retry: false,
    }),
  me: () =>
    queryOptions({
      queryKey: ["me"],
      queryFn: async () =>
        await unwrapEarly("/v1/me", async () => await api.GET("/v1/me")),
      staleTime: 5 * 60_000,
    }),
  members: () =>
    queryOptions({
      queryKey: ["members"],
      queryFn: async () => await unwrap(api.GET("/v1/members")),
      staleTime: 60_000,
    }),
  member: (ref: string) =>
    queryOptions({
      queryKey: ["members", ref],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/members/{ref}", { params: { path: { ref } } })
        ),
    }),
  now: (ref: string, days = 7) =>
    queryOptions({
      queryKey: ["now", ref, days],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/members/{ref}/now", {
            params: { path: { ref }, query: { days } },
          })
        ),
    }),
  // Under "now" so the live stream refreshes it with each person's; an object can't be a handle.
  teamNow: (days = 7) =>
    queryOptions({
      queryKey: ["now", { team: true }, days],
      queryFn: async () =>
        await unwrap(api.GET("/v1/now", { params: { query: { days } } })),
    }),
  tokens: (ref: string) =>
    queryOptions({
      queryKey: ["tokens", ref],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/members/{ref}/tokens", { params: { path: { ref } } })
        ),
    }),
  identities: (ref: string) =>
    queryOptions({
      queryKey: ["identities", ref],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/members/{ref}/identities", {
            params: { path: { ref } },
          })
        ),
    }),
  allIdentities: (unlinked?: boolean) =>
    queryOptions({
      queryKey: ["identities", "all", unlinked ?? false],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/identities", {
            params: { query: unlinked === true ? { unlinked: "true" } : {} },
          })
        ),
    }),

  boards: () =>
    queryOptions({
      queryKey: ["boards"],
      queryFn: async () => await unwrap(api.GET("/v1/boards")),
      staleTime: 60_000,
    }),
  board: (id: string) =>
    queryOptions({
      queryKey: ["boards", id],
      queryFn: async () =>
        await unwrap(api.GET("/v1/boards/{id}", { params: { path: { id } } })),
    }),
  cards: (filter: CardFilter = {}) =>
    queryOptions({
      queryKey: ["cards", filter],
      queryFn: async () =>
        await unwrap(api.GET("/v1/cards", { params: { query: filter } })),
    }),
  card: (number: number) =>
    queryOptions({
      queryKey: ["card", number],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/cards/{number}", {
            params: { path: { number } },
          })
        ),
    }),

  activities: (filter: Omit<ActivityFilter, "before" | "limit"> = {}) =>
    infiniteQueryOptions({
      queryKey: ["activities", filter],
      queryFn: async ({ pageParam }) =>
        await unwrap(
          api.GET("/v1/activities", {
            params: {
              query: { ...filter, limit: FEED_PAGE, before: pageParam },
            },
          })
        ),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) =>
        page.length < FEED_PAGE ? undefined : page.at(-1)?.occurredAt,
    }),
  recentActivities: (filter: Omit<ActivityFilter, "before"> = {}) =>
    queryOptions({
      queryKey: ["activities", "recent", filter],
      queryFn: async () =>
        await unwrap(api.GET("/v1/activities", { params: { query: filter } })),
    }),

  // Under "activities" so the live stream refreshes it with the feed.
  activityCounts: (since: string) =>
    queryOptions({
      queryKey: ["activities", "counts", since],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/activities/counts", { params: { query: { since } } })
        ),
    }),

  attention: (state: AttentionState = "open") =>
    queryOptions({
      queryKey: ["attention", state],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/attention", { params: { query: { state } } })
        ),
    }),
  // Under "attention" so every write that refreshes the inbox refreshes this item too.
  attentionItem: (id: string) =>
    queryOptions({
      queryKey: ["attention", "item", id],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/attention/{id}", { params: { path: { id } } })
        ),
    }),
  attentionMetrics: (days = 14) =>
    queryOptions({
      queryKey: ["attention", "metrics", days],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/attention/metrics", { params: { query: { days } } })
        ),
    }),

  briefs: () =>
    queryOptions({
      queryKey: ["briefs"],
      queryFn: async () => await unwrap(api.GET("/v1/briefs")),
    }),
  brief: (id: string) =>
    queryOptions({
      queryKey: ["briefs", id],
      queryFn: async () =>
        await unwrap(api.GET("/v1/briefs/{id}", { params: { path: { id } } })),
    }),

  conversations: () =>
    queryOptions({
      queryKey: ["conversations"],
      queryFn: async () => await unwrap(api.GET("/v1/conversations")),
    }),
  conversation: (id: string) =>
    queryOptions({
      queryKey: ["conversations", id],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/conversations/{id}", { params: { path: { id } } })
        ),
    }),
  usage: (days = 7) =>
    queryOptions({
      queryKey: ["usage", days],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/assistant/usage", { params: { query: { days } } })
        ),
    }),
  ratings: () =>
    queryOptions({
      queryKey: ["ratings"],
      queryFn: async () => await unwrap(api.GET("/v1/ratings")),
    }),
  voice: () =>
    queryOptions({
      queryKey: ["voice"],
      queryFn: async () => await unwrap(api.GET("/v1/voice")),
    }),
  voiceHistory: () =>
    queryOptions({
      queryKey: ["voice", "history"],
      queryFn: async () => await unwrap(api.GET("/v1/voice/history")),
    }),
  memories: (filter: Query<"/v1/memories"> = {}) =>
    queryOptions({
      queryKey: ["memories", filter],
      queryFn: async () =>
        await unwrap(api.GET("/v1/memories", { params: { query: filter } })),
    }),
  memoryHistory: (id: string) =>
    queryOptions({
      queryKey: ["memories", "history", id],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/memories/{id}/history", { params: { path: { id } } })
        ),
    }),

  targets: () =>
    queryOptions({
      queryKey: ["targets"],
      queryFn: async () => await unwrap(api.GET("/v1/delivery-targets")),
    }),
  automations: () =>
    queryOptions({
      queryKey: ["automations"],
      queryFn: async () => await unwrap(api.GET("/v1/automations")),
    }),
  automationRuns: (id: string) =>
    queryOptions({
      queryKey: ["automations", id, "runs"],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/automations/{id}/runs", { params: { path: { id } } })
        ),
    }),

  connectors: () =>
    queryOptions({
      queryKey: ["connectors"],
      queryFn: async () => await unwrap(api.GET("/v1/connectors")),
      staleTime: Number.POSITIVE_INFINITY,
    }),
  connections: () =>
    queryOptions({
      queryKey: ["connections"],
      queryFn: async () => await unwrap(api.GET("/v1/connections")),
    }),
  connectionHealth: (id: string) =>
    queryOptions({
      queryKey: ["connections", id, "health"],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/connections/{id}/health", { params: { path: { id } } })
        ),
    }),
  deliveries: (id: string) =>
    queryOptions({
      queryKey: ["connections", id, "deliveries"],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/connections/{id}/deliveries", {
            params: { path: { id }, query: { limit: 50 } },
          })
        ),
    }),
  sources: (id: string) =>
    queryOptions({
      queryKey: ["connections", id, "sources"],
      queryFn: async () =>
        await unwrap(
          api.GET("/v1/connections/{id}/sources", { params: { path: { id } } })
        ),
    }),
  apps: () =>
    queryOptions({
      queryKey: ["apps"],
      queryFn: async () => await unwrap(api.GET("/v1/apps")),
    }),
};
