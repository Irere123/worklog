import type { QueryClient } from "@tanstack/react-query";

import { ribbonSince, startOfYesterday } from "#lib/time";

import type { ActivityFilter } from "./queries";
import { q } from "./queries";

function ignore() {
  return null;
}

export function preloadShell(client: QueryClient) {
  void client.query(q.attention("open")).catch(ignore);
  void client.query(q.boards()).catch(ignore);
  void client.query(q.members()).catch(ignore);
}

export function preloadHome(client: QueryClient) {
  void client.query(q.activityCounts(startOfYesterday())).catch(ignore);
  void client.query(q.cards({ assignee: "me", stage: "active" })).catch(ignore);
  void client.query(q.cards({ assignee: "me", stage: "triage" })).catch(ignore);
  void client.query(q.connections()).catch(ignore);
  void client.query(q.targets()).catch(ignore);
  void client.query(q.voice()).catch(ignore);
  void client.query(q.teamNow(3)).catch(ignore);
}

export function preloadPeople(client: QueryClient) {
  void client.query(q.teamNow(3)).catch(ignore);
}

export function preloadPerson(client: QueryClient, handle: string) {
  void client.query(q.member(handle)).catch(ignore);
  void client.query(q.now(handle, 7)).catch(ignore);
  void client.query(q.teamNow(3)).catch(ignore);
  void client
    .query(q.recentActivities({ actor: handle, limit: 60 }))
    .catch(ignore);
  void client.infiniteQuery(q.activities({ actor: handle })).catch(ignore);
}

export function preloadBoard(client: QueryClient, board: string) {
  void client.query(q.cards({ board, stage: "active" })).catch(ignore);
  void client.query(q.cards({ board, stage: "triage" })).catch(ignore);
  void client
    .query(q.cards({ board, stage: "not_now", limit: 100 }))
    .catch(ignore);
  void client
    .query(q.cards({ board, stage: "done", limit: 100 }))
    .catch(ignore);
  void client.query(q.teamNow(3)).catch(ignore);
}

export function preloadActivity(
  client: QueryClient,
  filter: Omit<ActivityFilter, "before" | "limit">
) {
  void client.infiniteQuery(q.activities(filter)).catch(ignore);
  void client
    .query(q.recentActivities({ since: ribbonSince(Date.now()), limit: 500 }))
    .catch(ignore);
}
