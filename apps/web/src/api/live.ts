import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";

import { auth } from "./client";
import type { Schemas } from "./client";
import { q } from "./queries";

type Presence = Schemas["AssistantPresence"];

type EventType =
  | "activity.created"
  | "activity.updated"
  | "card.updated"
  | "attention.updated"
  | "brief.created"
  | "message.created"
  | "automation.ran"
  | "notification.sent"
  | "assistant.updated";

const STALE: Record<EventType, QueryKey[]> = {
  "activity.created": [["activities"], ["now"]],
  "activity.updated": [["activities"], ["now"]],
  "card.updated": [["cards"], ["card"], ["now"]],
  "attention.updated": [["attention"]],
  "brief.created": [["briefs"]],
  "message.created": [["conversations"]],
  "automation.ran": [["automations"]],
  "notification.sent": [],
  // Carries the whole snapshot, so nothing is read again.
  "assistant.updated": [],
};

// A webhook burst lands as dozens of events in a second; one refetch per family covers them all.
const SETTLE_MS = 250;

export type LiveStatus = "connecting" | "live" | "offline";

/** What an attention event says about the item: enough to tell someone it arrived. */
export type AttentionNews = {
  id: string;
  kind: string;
  title: string;
  priority: "low" | "normal" | "high";
  state: string;
};

/** Something the server delivered to this member: a ping, a brief, a digest or a routine's message. */
export type SentNews = {
  id: string;
  kind: string;
  subject: string;
  itemIds: string[];
};

export type LiveHandlers = {
  attention?: (news: AttentionNews) => void;
  sent?: (news: SentNews) => void;
};

const PRIORITIES = new Set<unknown>(["low", "normal", "high"]);

function isAttentionNews(value: unknown): value is AttentionNews {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "state" in value &&
    typeof value.state === "string" &&
    "priority" in value &&
    PRIORITIES.has(value.priority)
  );
}

function isSentNews(value: unknown): value is SentNews {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "subject" in value &&
    typeof value.subject === "string" &&
    "itemIds" in value &&
    Array.isArray(value.itemIds) &&
    value.itemIds.every((id) => typeof id === "string")
  );
}

const STATES = new Set<unknown>(["working", "waiting", "done", "idle"]);

/** The assistant's presence as the server sends it on every change: whole, never a diff. */
function isPresence(value: unknown): value is Presence {
  return (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    STATES.has(value.state) &&
    "asOf" in value &&
    typeof value.asOf === "string" &&
    "working" in value &&
    Array.isArray(value.working) &&
    "waiting" in value &&
    typeof value.waiting === "number" &&
    "done" in value &&
    Array.isArray(value.done) &&
    "next" in value
  );
}

function payloadOf(event: Event): unknown {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(event.data);
    return typeof parsed === "object" && parsed !== null && "data" in parsed
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the cache honest from the server's event stream. The browser's EventSource reconnects by
 * itself and resends Last-Event-ID, so the server replays what was missed.
 */
export function useLiveEvents(
  client: QueryClient,
  enabled: boolean,
  handlers: LiveHandlers = {}
) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const onAttention = useEffectEvent((news: AttentionNews) =>
    handlers.attention?.(news)
  );
  const onSent = useEffectEvent((news: SentNews) => handlers.sent?.(news));

  useEffect(
    () =>
      enabled
        ? subscribe(client, setStatus, { attention: onAttention, sent: onSent })
        : undefined,
    [client, enabled]
  );

  return status;
}

function subscribe(
  client: QueryClient,
  setStatus: (status: LiveStatus) => void,
  notify: Required<LiveHandlers>
) {
  const key = auth.key();
  const params = new URLSearchParams();
  if (key) {
    params.set("token", key);
  }
  const workspace = auth.workspace();
  if (workspace) {
    params.set("workspace", workspace);
  }
  const source = new EventSource(`/v1/events?${params.toString()}`, {
    withCredentials: true,
  });
  const pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    for (const queryKey of pending.values()) {
      void client.invalidateQueries({ queryKey });
    }
    pending.clear();
  };
  const onEvent = (stale: QueryKey[]) => () => {
    for (const queryKey of stale) {
      pending.set(JSON.stringify(queryKey), queryKey);
    }
    timer ??= setTimeout(flush, SETTLE_MS);
  };

  source.addEventListener("server.connected", () => {
    setStatus("live");
  });
  source.addEventListener("error", () => {
    setStatus(
      source.readyState === EventSource.CLOSED ? "offline" : "connecting"
    );
  });
  for (const [type, stale] of Object.entries(STALE)) {
    source.addEventListener(type, onEvent(stale));
  }
  // Only items that are new to this tab: the cached inbox already holds anything seen before.
  source.addEventListener("attention.updated", (event) => {
    const data = payloadOf(event);
    const news = isAttentionNews(data) ? data : null;
    const known = client
      .getQueryData<{ id: string }[]>(["attention", "open"])
      ?.some((item) => item.id === news?.id);
    if (news?.state === "open" && known !== true) {
      notify.attention(news);
    }
  });
  // Out-of-order snapshots are settled by the query itself, which keeps the newest.
  source.addEventListener("assistant.updated", (event) => {
    const data = payloadOf(event);
    if (isPresence(data)) {
      client.setQueryData(q.presence().queryKey, data);
    } else {
      // Replayed from before snapshots travelled with the event.
      onEvent([["presence"]])();
    }
  });
  source.addEventListener("notification.sent", (event) => {
    const data = payloadOf(event);
    if (isSentNews(data)) {
      notify.sent(data);
    }
  });
  return () => {
    source.close();
    if (timer) {
      clearTimeout(timer);
    }
  };
}
